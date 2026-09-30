use crate::domain::material::{Material, MaterialLibraryDocument};
use crate::error::{AppError, AppResult};
use chrono::Utc;
use quick_xml::events::Event;
use quick_xml::{Reader, XmlVersion};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use uuid::Uuid;

const SCHEMA_VERSION: u32 = 1;

pub fn import_materials(path: &Path) -> AppResult<Vec<Material>> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let text = fs::read_to_string(path).map_err(AppError::io)?;
    let mut materials = match extension.as_str() {
        "json" => import_json(&text)?,
        "xml" | "matml" => import_matml(&text)?,
        "inp" => import_calculix(&text)?,
        _ => return Err(AppError::UnsupportedMaterialFormat),
    };
    if materials.is_empty() {
        return Err(AppError::InvalidMaterial(
            "The selected file does not contain any supported material definitions.".to_owned(),
        ));
    }
    // Imported IDs must never accidentally overwrite an existing project material.
    for material in &mut materials {
        material.id = Uuid::new_v4();
        material.built_in = false;
        material.based_on = None;
        material.created_at = Utc::now();
        material.updated_at = material.created_at;
    }
    Ok(materials)
}

pub fn export_materials(path: &Path, materials: &[Material]) -> AppResult<()> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let bytes = match extension.as_str() {
        "json" => serde_json::to_vec_pretty(&MaterialLibraryDocument {
            schema_version: SCHEMA_VERSION,
            generator: format!("TesRig {}", env!("CARGO_PKG_VERSION")),
            materials: materials.to_vec(),
        })
        .map_err(|error| AppError::InvalidMaterial(error.to_string()))?,
        "xml" | "matml" => export_matml(materials).into_bytes(),
        "inp" => export_calculix(materials).into_bytes(),
        _ => return Err(AppError::UnsupportedMaterialFormat),
    };
    fs::write(path, bytes).map_err(AppError::io)
}

fn import_json(text: &str) -> AppResult<Vec<Material>> {
    if let Ok(document) = serde_json::from_str::<MaterialLibraryDocument>(text) {
        if document.schema_version != SCHEMA_VERSION {
            return Err(AppError::InvalidMaterial(format!(
                "Material library schema version {} is not supported.",
                document.schema_version
            )));
        }
        return Ok(document.materials);
    }
    serde_json::from_str::<Material>(text)
        .map(|material| vec![material])
        .map_err(|error| AppError::InvalidMaterial(format!("Invalid material JSON: {error}")))
}

fn import_calculix(text: &str) -> AppResult<Vec<Material>> {
    let mut materials = Vec::new();
    let mut current: Option<Material> = None;
    let mut keyword = String::new();
    for raw_line in text.lines() {
        let line = raw_line.trim();
        if let Some(appearance) = line.strip_prefix("** TESRIG_APPEARANCE ") {
            if let Some(material) = current.as_mut() {
                for entry in appearance.split_whitespace() {
                    let Some((key, value)) = entry.split_once('=') else {
                        continue;
                    };
                    match key {
                        "baseColor" => material.appearance.base_color = value.to_owned(),
                        "metalness" => {
                            if let Ok(number) = value.parse() {
                                material.appearance.metalness = number;
                            }
                        }
                        "roughness" => {
                            if let Ok(number) = value.parse() {
                                material.appearance.roughness = number;
                            }
                        }
                        "opacity" => {
                            if let Ok(number) = value.parse() {
                                material.appearance.opacity = number;
                            }
                        }
                        _ => {}
                    }
                }
            }
            continue;
        }
        if line.is_empty() || line.starts_with("**") {
            continue;
        }
        if line.starts_with('*') {
            keyword = line
                .split(',')
                .next()
                .unwrap_or_default()
                .to_ascii_uppercase();
            if keyword == "*MATERIAL" {
                if let Some(material) = current.take() {
                    materials.push(material);
                }
                let name = line
                    .split(',')
                    .skip(1)
                    .find_map(|part| part.trim().strip_prefix("NAME="))
                    .unwrap_or("Imported material")
                    .trim_matches('"');
                current = Some(Material::custom(name.to_owned(), None));
            }
            continue;
        }
        let Some(material) = current.as_mut() else {
            continue;
        };
        let values = line
            .split(',')
            .filter_map(|value| value.trim().parse::<f64>().ok())
            .collect::<Vec<_>>();
        match keyword.as_str() {
            "*DENSITY" => material.mechanical.density = values.first().copied(),
            "*ELASTIC" => {
                material.mechanical.youngs_modulus = values.first().copied();
                material.mechanical.poissons_ratio = values.get(1).copied();
            }
            "*EXPANSION" => {
                material.thermal.thermal_expansion_coefficient = values.first().copied()
            }
            "*CONDUCTIVITY" => material.thermal.thermal_conductivity = values.first().copied(),
            "*SPECIFIC HEAT" => material.thermal.specific_heat = values.first().copied(),
            "*PLASTIC" if material.mechanical.yield_strength.is_none() => {
                material.mechanical.yield_strength = values.first().copied();
            }
            _ => {}
        }
    }
    if let Some(material) = current {
        materials.push(material);
    }
    Ok(materials)
}

fn export_calculix(materials: &[Material]) -> String {
    let mut output = String::from("** TesRig material library - SI units (kg, m, s, K, Pa)\n");
    for material in materials {
        output.push_str(&format!(
            "*MATERIAL, NAME={}\n",
            material.name.replace(',', "_")
        ));
        if let Some(value) = material.mechanical.density {
            output.push_str(&format!("*DENSITY\n{value:.9e}\n"));
        }
        if let (Some(youngs_modulus), Some(poissons_ratio)) = (
            material.mechanical.youngs_modulus,
            material.mechanical.poissons_ratio,
        ) {
            output.push_str(&format!(
                "*ELASTIC\n{youngs_modulus:.9e}, {poissons_ratio:.9e}\n"
            ));
        }
        if let Some(value) = material.mechanical.yield_strength {
            output.push_str(&format!("*PLASTIC\n{value:.9e}, 0.0\n"));
        }
        if let Some(value) = material.thermal.thermal_expansion_coefficient {
            output.push_str(&format!("*EXPANSION\n{value:.9e}\n"));
        }
        if let Some(value) = material.thermal.thermal_conductivity {
            output.push_str(&format!("*CONDUCTIVITY\n{value:.9e}\n"));
        }
        if let Some(value) = material.thermal.specific_heat {
            output.push_str(&format!("*SPECIFIC HEAT\n{value:.9e}\n"));
        }
        output.push_str(&format!(
            "** TESRIG_APPEARANCE baseColor={} metalness={} roughness={} opacity={}\n",
            material.appearance.base_color,
            material.appearance.metalness,
            material.appearance.roughness,
            material.appearance.opacity
        ));
    }
    output
}

const MATML_PROPERTIES: [(&str, &str, &str); 12] = [
    ("density", "Density", "kg/m^3"),
    ("youngsModulus", "Young's modulus", "Pa"),
    ("poissonsRatio", "Poisson's ratio", "1"),
    ("yieldStrength", "Yield strength", "Pa"),
    ("ultimateTensileStrength", "Ultimate tensile strength", "Pa"),
    ("thermalConductivity", "Thermal conductivity", "W/(m*K)"),
    ("specificHeat", "Specific heat", "J/(kg*K)"),
    (
        "thermalExpansionCoefficient",
        "Thermal expansion coefficient",
        "1/K",
    ),
    ("baseColor", "TesRig base color", "1"),
    ("metalness", "TesRig metalness", "1"),
    ("roughness", "TesRig roughness", "1"),
    ("opacity", "TesRig opacity", "1"),
];

fn export_matml(materials: &[Material]) -> String {
    let mut xml = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<MatML_Doc xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\">\n");
    for material in materials {
        xml.push_str("  <Material><BulkDetails>\n");
        xml.push_str(&format!(
            "    <Name>{}</Name>\n",
            escape_xml(&material.name)
        ));
        xml.push_str(&format!(
            "    <Class><Name>{}</Name></Class>\n",
            escape_xml(&material.category)
        ));
        xml.push_str(&format!(
            "    <Notes>{}</Notes>\n",
            escape_xml(&material.description)
        ));
        for (property, value) in material_values(material) {
            let format = if property == "baseColor" {
                "string"
            } else {
                "float"
            };
            xml.push_str(&format!("    <PropertyData property=\"{property}\"><Data format=\"{format}\">{}</Data></PropertyData>\n", escape_xml(&value)));
        }
        xml.push_str("  </BulkDetails></Material>\n");
    }
    xml.push_str("  <Metadata>\n");
    for (id, name, unit) in MATML_PROPERTIES {
        xml.push_str(&format!("    <PropertyDetails id=\"{id}\"><Name>{}</Name><Units><Unit><Name>{}</Name></Unit></Units></PropertyDetails>\n", escape_xml(name), escape_xml(unit)));
    }
    xml.push_str("  </Metadata>\n</MatML_Doc>\n");
    xml
}

fn material_values(material: &Material) -> Vec<(&'static str, String)> {
    let mut values = Vec::new();
    macro_rules! push_value {
        ($id:literal, $value:expr) => {
            if let Some(value) = $value {
                values.push(($id, value.to_string()));
            }
        };
    }
    push_value!("density", material.mechanical.density);
    push_value!("youngsModulus", material.mechanical.youngs_modulus);
    push_value!("poissonsRatio", material.mechanical.poissons_ratio);
    push_value!("yieldStrength", material.mechanical.yield_strength);
    push_value!(
        "ultimateTensileStrength",
        material.mechanical.ultimate_tensile_strength
    );
    push_value!("thermalConductivity", material.thermal.thermal_conductivity);
    push_value!("specificHeat", material.thermal.specific_heat);
    push_value!(
        "thermalExpansionCoefficient",
        material.thermal.thermal_expansion_coefficient
    );
    values.push(("baseColor", material.appearance.base_color.clone()));
    values.push(("metalness", material.appearance.metalness.to_string()));
    values.push(("roughness", material.appearance.roughness.to_string()));
    values.push(("opacity", material.appearance.opacity.to_string()));
    values
}

fn import_matml(text: &str) -> AppResult<Vec<Material>> {
    let property_details = read_matml_property_details(text)?;
    let mut reader = Reader::from_str(text);
    reader.config_mut().trim_text(true);
    let mut materials = Vec::new();
    let mut current: Option<Material> = None;
    let mut stack: Vec<String> = Vec::new();
    let mut property = String::new();
    loop {
        match reader.read_event() {
            Ok(Event::Start(event)) => {
                let tag = event.name().as_ref().to_owned();
                if tag == "Material" {
                    current = Some(Material::custom("Imported material".to_owned(), None));
                } else if tag == "PropertyData" {
                    property = event
                        .attributes()
                        .flatten()
                        .find(|attribute| attribute.key.as_ref() == "property")
                        .and_then(|attribute| {
                            attribute.normalized_value(XmlVersion::Implicit1_0).ok()
                        })
                        .map(|value| value.into_owned())
                        .unwrap_or_default();
                }
                stack.push(tag);
            }
            Ok(Event::Text(event)) => {
                let value = event.xml10_content().into_owned();
                let tag = stack.last().map(String::as_str).unwrap_or_default();
                let parent = stack
                    .len()
                    .checked_sub(2)
                    .and_then(|index| stack.get(index))
                    .map(String::as_str)
                    .unwrap_or_default();
                if let Some(material) = current.as_mut() {
                    if tag == "Name" && parent == "BulkDetails" {
                        material.name = value;
                    } else if (tag == "Name" && parent == "Class") || tag == "Class" {
                        material.category = value;
                    } else if tag == "Notes" {
                        material.description = value;
                    } else if tag == "Data" {
                        apply_property(material, &property, &value, &property_details);
                    }
                }
            }
            Ok(Event::End(event)) => {
                let tag = event.name().as_ref().to_owned();
                if tag == "Material" {
                    if let Some(material) = current.take() {
                        materials.push(material);
                    }
                } else if tag == "PropertyData" {
                    property.clear();
                }
                stack.pop();
            }
            Ok(Event::Eof) => break,
            Err(error) => return Err(AppError::InvalidMaterial(format!("Invalid MatML: {error}"))),
            _ => {}
        }
    }
    Ok(materials)
}

fn read_matml_property_details(text: &str) -> AppResult<HashMap<String, (String, String)>> {
    let mut reader = Reader::from_str(text);
    reader.config_mut().trim_text(true);
    let mut details = HashMap::new();
    let mut stack: Vec<String> = Vec::new();
    let mut property_id = String::new();
    let mut property_name = String::new();
    let mut unit = String::new();
    loop {
        match reader.read_event() {
            Ok(Event::Start(event)) => {
                let tag = event.name().as_ref().to_owned();
                if tag == "PropertyDetails" {
                    property_id = event
                        .attributes()
                        .flatten()
                        .find(|attribute| attribute.key.as_ref() == "id")
                        .and_then(|attribute| {
                            attribute.normalized_value(XmlVersion::Implicit1_0).ok()
                        })
                        .map(|value| value.into_owned())
                        .unwrap_or_default();
                    property_name.clear();
                    unit.clear();
                }
                stack.push(tag);
            }
            Ok(Event::Text(event)) if !property_id.is_empty() => {
                let tag = stack.last().map(String::as_str).unwrap_or_default();
                let parent = stack
                    .len()
                    .checked_sub(2)
                    .and_then(|index| stack.get(index))
                    .map(String::as_str)
                    .unwrap_or_default();
                if tag == "Name" && parent == "PropertyDetails" {
                    property_name = event.xml10_content().into_owned();
                } else if (tag == "Name" && parent == "Unit") || tag == "Unit" {
                    unit = event.xml10_content().into_owned();
                }
            }
            Ok(Event::End(event)) => {
                let tag = event.name().as_ref().to_owned();
                if tag == "PropertyDetails" && !property_id.is_empty() {
                    details.insert(property_id.clone(), (property_name.clone(), unit.clone()));
                    property_id.clear();
                }
                stack.pop();
            }
            Ok(Event::Eof) => break,
            Err(error) => return Err(AppError::InvalidMaterial(format!("Invalid MatML: {error}"))),
            _ => {}
        }
    }
    Ok(details)
}

fn apply_property(
    material: &mut Material,
    property: &str,
    value: &str,
    property_details: &HashMap<String, (String, String)>,
) {
    let (property_name, unit) = property_details
        .get(property)
        .map(|(name, unit)| (name.as_str(), unit.as_str()))
        .unwrap_or((property, ""));
    let name = property_name
        .to_ascii_lowercase()
        .replace([' ', '-', '\'', '_'], "");
    let number = value
        .trim()
        .parse::<f64>()
        .ok()
        .map(|number| convert_to_si(number, &name, unit));
    match name.as_str() {
        "density" => material.mechanical.density = number,
        "youngsmodulus" | "elasticmodulus" => material.mechanical.youngs_modulus = number,
        "poissonsratio" => material.mechanical.poissons_ratio = number,
        "yieldstrength" => material.mechanical.yield_strength = number,
        "ultimatetensilestrength" | "tensilestrength" => {
            material.mechanical.ultimate_tensile_strength = number
        }
        "thermalconductivity" => material.thermal.thermal_conductivity = number,
        "specificheat" | "specificheatcapacity" => material.thermal.specific_heat = number,
        "thermalexpansioncoefficient" | "coefficientofthermalexpansion" => {
            material.thermal.thermal_expansion_coefficient = number
        }
        "tesrigbasecolor" | "basecolor" => material.appearance.base_color = value.to_owned(),
        "tesrigmetalness" | "metalness" => {
            if let Some(number) = number {
                material.appearance.metalness = number;
            }
        }
        "tesrigroughness" | "roughness" => {
            if let Some(number) = number {
                material.appearance.roughness = number;
            }
        }
        "tesrigopacity" | "opacity" => {
            if let Some(number) = number {
                material.appearance.opacity = number;
            }
        }
        _ => {}
    }
}

fn convert_to_si(value: f64, property_name: &str, unit: &str) -> f64 {
    let normalized_unit = unit
        .to_ascii_lowercase()
        .replace([' ', '·', '*', '(', ')', '^'], "");
    if property_name == "density" && normalized_unit.contains("g/cm3") {
        value * 1_000.0
    } else if matches!(
        property_name,
        "youngsmodulus"
            | "elasticmodulus"
            | "yieldstrength"
            | "ultimatetensilestrength"
            | "tensilestrength"
    ) && normalized_unit == "gpa"
    {
        value * 1e9
    } else if matches!(
        property_name,
        "youngsmodulus"
            | "elasticmodulus"
            | "yieldstrength"
            | "ultimatetensilestrength"
            | "tensilestrength"
    ) && normalized_unit == "mpa"
    {
        value * 1e6
    } else if property_name == "specificheat" && normalized_unit.starts_with("kj/") {
        value * 1_000.0
    } else if matches!(
        property_name,
        "thermalexpansioncoefficient" | "coefficientofthermalexpansion"
    ) && (normalized_unit.contains("10-6") || normalized_unit.contains("µ"))
    {
        value * 1e-6
    } else {
        value
    }
}

fn escape_xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::material::default_material_library;

    #[test]
    fn calculix_round_trip_preserves_core_physical_properties() {
        let source = default_material_library().remove(9);
        let parsed = import_calculix(&export_calculix(std::slice::from_ref(&source))).unwrap();
        assert_eq!(parsed[0].name, source.name);
        assert_eq!(parsed[0].mechanical.density, source.mechanical.density);
        assert_eq!(
            parsed[0].mechanical.youngs_modulus,
            source.mechanical.youngs_modulus
        );
        assert_eq!(parsed[0].appearance, source.appearance);
    }

    #[test]
    fn matml_round_trip_preserves_visual_and_physical_properties() {
        let source = default_material_library().remove(3);
        let parsed = import_matml(&export_matml(std::slice::from_ref(&source))).unwrap();
        assert_eq!(parsed[0].name, source.name);
        assert_eq!(parsed[0].mechanical.density, source.mechanical.density);
        assert_eq!(
            parsed[0].appearance.base_color,
            source.appearance.base_color
        );
    }
}
