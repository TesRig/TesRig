use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MechanicalProperties {
    pub density: Option<f64>,
    pub youngs_modulus: Option<f64>,
    pub poissons_ratio: Option<f64>,
    pub yield_strength: Option<f64>,
    pub ultimate_tensile_strength: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ThermalProperties {
    pub thermal_conductivity: Option<f64>,
    pub specific_heat: Option<f64>,
    pub thermal_expansion_coefficient: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterialAppearance {
    pub base_color: String,
    pub metalness: f64,
    pub roughness: f64,
    pub opacity: f64,
}

impl Default for MaterialAppearance {
    fn default() -> Self {
        Self {
            base_color: "#72CFFF".to_owned(),
            metalness: 0.0,
            roughness: 0.45,
            opacity: 1.0,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterialSource {
    pub title: String,
    pub url: String,
    pub note: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Material {
    pub id: Uuid,
    pub name: String,
    pub category: String,
    pub description: String,
    pub mechanical: MechanicalProperties,
    pub thermal: ThermalProperties,
    pub appearance: MaterialAppearance,
    #[serde(default)]
    pub sources: Vec<MaterialSource>,
    pub based_on: Option<Uuid>,
    #[serde(default)]
    pub built_in: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterialLibraryDocument {
    pub schema_version: u32,
    pub generator: String,
    pub materials: Vec<Material>,
}

impl Material {
    pub fn custom(name: String, based_on: Option<Uuid>) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4(),
            name,
            category: "Custom".to_owned(),
            description: String::new(),
            mechanical: MechanicalProperties::default(),
            thermal: ThermalProperties::default(),
            appearance: MaterialAppearance::default(),
            sources: Vec::new(),
            based_on,
            built_in: false,
            created_at: now,
            updated_at: now,
        }
    }
}

fn source(title: &str, url: &str, note: &str) -> MaterialSource {
    MaterialSource {
        title: title.to_owned(),
        url: url.to_owned(),
        note: note.to_owned(),
    }
}

#[allow(clippy::too_many_arguments)]
fn catalog_material(
    id: &str,
    name: &str,
    category: &str,
    description: &str,
    density: f64,
    youngs_modulus: f64,
    poissons_ratio: f64,
    yield_strength: Option<f64>,
    ultimate_tensile_strength: Option<f64>,
    thermal_conductivity: Option<f64>,
    specific_heat: Option<f64>,
    thermal_expansion_coefficient: Option<f64>,
    base_color: &str,
    metalness: f64,
    roughness: f64,
    sources: Vec<MaterialSource>,
) -> Material {
    let created_at = DateTime::parse_from_rfc3339("2026-01-01T00:00:00Z")
        .expect("valid catalog timestamp")
        .with_timezone(&Utc);
    Material {
        id: Uuid::parse_str(id).expect("valid catalog id"),
        name: name.to_owned(),
        category: category.to_owned(),
        description: description.to_owned(),
        mechanical: MechanicalProperties {
            density: Some(density),
            youngs_modulus: Some(youngs_modulus),
            poissons_ratio: Some(poissons_ratio),
            yield_strength,
            ultimate_tensile_strength,
        },
        thermal: ThermalProperties {
            thermal_conductivity,
            specific_heat,
            thermal_expansion_coefficient,
        },
        appearance: MaterialAppearance {
            base_color: base_color.to_owned(),
            metalness,
            roughness,
            opacity: 1.0,
        },
        sources,
        based_on: None,
        built_in: true,
        created_at,
        updated_at: created_at,
    }
}

/// Nominal, room-temperature, isotropic starting values. Polymer entries are
/// explicitly generic because printed-part properties depend strongly on grade,
/// moisture, raster direction, infill, and process parameters.
pub fn default_material_library() -> Vec<Material> {
    let polymer_source = || {
        source(
        "UltiMaker material technical data",
        "https://ultimaker.com/materials/",
        "Representative filament/printed-part data; validate against the selected grade and print process.",
    )
    };
    let metals_source = || {
        source(
        "NIST Materials Data Repository",
        "https://materialsdata.nist.gov/",
        "Representative engineering values; validate against the applicable product specification and temper.",
    )
    };
    vec![
        catalog_material("10000000-0000-4000-8000-000000000001", "PLA", "3D-printing polymer", "Generic polylactic acid filament; printed parts are anisotropic.", 1240.0, 3.5e9, 0.36, Some(50e6), Some(60e6), Some(0.13), Some(1800.0), Some(68e-6), "#E8DCC6", 0.0, 0.62, vec![polymer_source()]),
        catalog_material("10000000-0000-4000-8000-000000000002", "PLA+", "3D-printing polymer", "Generic toughened PLA blend; properties vary by manufacturer.", 1230.0, 2.8e9, 0.36, Some(45e6), Some(55e6), Some(0.13), Some(1800.0), Some(70e-6), "#F1B24A", 0.0, 0.58, vec![polymer_source()]),
        catalog_material("10000000-0000-4000-8000-000000000003", "ABS", "3D-printing polymer", "Generic acrylonitrile butadiene styrene filament.", 1040.0, 2.1e9, 0.35, Some(40e6), Some(43e6), Some(0.18), Some(1300.0), Some(90e-6), "#D7D9DD", 0.0, 0.48, vec![polymer_source()]),
        catalog_material("10000000-0000-4000-8000-000000000004", "PETG", "3D-printing polymer", "Generic glycol-modified PET filament.", 1270.0, 2.05e9, 0.38, Some(47e6), Some(50e6), Some(0.20), Some(1200.0), Some(65e-6), "#64B9B4", 0.0, 0.38, vec![polymer_source()]),
        catalog_material("10000000-0000-4000-8000-000000000005", "TPU 95A", "Elastomer", "Flexible thermoplastic polyurethane, Shore 95A; linear-elastic data is only a small-strain approximation.", 1220.0, 26e6, 0.48, Some(7e6), Some(39e6), Some(0.20), Some(1500.0), Some(150e-6), "#4F78D1", 0.0, 0.7, vec![source("UltiMaker TPU 95A technical data sheet", "https://um-support-files.ultimaker.com/materials/2.85mm/tds/TPU-95A/TDS-TPU95A-V2.01-250915.pdf", "Specific gravity and representative printed-part test data; hyperelastic characterization is recommended.")]),
        catalog_material("10000000-0000-4000-8000-000000000006", "Carbon Fiber / Epoxy (quasi-isotropic)", "Composite", "Representative quasi-isotropic laminate approximation. Use an orthotropic layup model for final composite analysis.", 1550.0, 55e9, 0.30, Some(450e6), Some(600e6), Some(5.0), Some(900.0), Some(2e-6), "#25282A", 0.05, 0.72, vec![source("NASA Composite Materials Handbook (CMH-17)", "https://www.nasa.gov/reference/composite-materials-handbook-17/", "Representative laminate starting values only; properties depend on fiber, resin, layup, cure, and direction.")]),
        catalog_material("10000000-0000-4000-8000-000000000007", "Nylon 6", "Engineering polymer", "Generic conditioned polyamide 6.", 1130.0, 2.7e9, 0.39, Some(70e6), Some(80e6), Some(0.25), Some(1700.0), Some(85e-6), "#D8D0B8", 0.0, 0.56, vec![polymer_source()]),
        catalog_material("10000000-0000-4000-8000-000000000008", "Polycarbonate", "Engineering polymer", "Generic unfilled polycarbonate.", 1200.0, 2.4e9, 0.37, Some(62e6), Some(66e6), Some(0.20), Some(1200.0), Some(65e-6), "#B9C9D3", 0.0, 0.3, vec![polymer_source()]),
        catalog_material("10000000-0000-4000-8000-000000000009", "ASA", "3D-printing polymer", "Generic UV-resistant acrylonitrile styrene acrylate filament.", 1070.0, 2.3e9, 0.35, Some(42e6), Some(49e6), Some(0.17), Some(1400.0), Some(90e-6), "#EFEAE0", 0.0, 0.5, vec![polymer_source()]),
        catalog_material("10000000-0000-4000-8000-000000000010", "Aluminum 6061-T6", "Metal", "Common precipitation-hardened structural aluminum alloy.", 2700.0, 68.9e9, 0.33, Some(276e6), Some(310e6), Some(167.0), Some(896.0), Some(23.6e-6), "#B9BDC2", 0.88, 0.28, vec![metals_source()]),
        catalog_material("10000000-0000-4000-8000-000000000011", "Structural Steel", "Metal", "Generic mild structural steel; select the specified grade before final analysis.", 7850.0, 200e9, 0.30, Some(250e6), Some(400e6), Some(50.0), Some(486.0), Some(12e-6), "#7B8288", 0.82, 0.38, vec![metals_source()]),
        catalog_material("10000000-0000-4000-8000-000000000012", "Stainless Steel 304", "Metal", "Austenitic stainless steel, annealed nominal values.", 8000.0, 193e9, 0.29, Some(215e6), Some(505e6), Some(16.2), Some(500.0), Some(17.2e-6), "#A7ADB1", 0.92, 0.24, vec![metals_source()]),
        catalog_material("10000000-0000-4000-8000-000000000013", "Titanium Ti-6Al-4V", "Metal", "Common alpha-beta titanium alloy, nominal annealed values.", 4430.0, 114e9, 0.34, Some(880e6), Some(950e6), Some(6.7), Some(526.0), Some(8.6e-6), "#777C86", 0.82, 0.34, vec![metals_source()]),
        catalog_material("10000000-0000-4000-8000-000000000014", "Copper C110", "Metal", "Electrolytic tough-pitch copper, nominal annealed values.", 8960.0, 117e9, 0.34, Some(69e6), Some(220e6), Some(391.0), Some(385.0), Some(16.5e-6), "#B66A45", 0.9, 0.25, vec![metals_source()]),
        catalog_material("10000000-0000-4000-8000-000000000015", "Brass C260", "Metal", "Cartridge brass nominal values.", 8530.0, 110e9, 0.34, Some(95e6), Some(315e6), Some(120.0), Some(380.0), Some(20e-6), "#B99B4F", 0.84, 0.3, vec![metals_source()]),
        catalog_material("10000000-0000-4000-8000-000000000016", "Soda-lime Glass", "Ceramic", "Generic isotropic soda-lime glass; brittle failure requires an appropriate fracture criterion.", 2500.0, 70e9, 0.22, None, Some(45e6), Some(1.0), Some(840.0), Some(9e-6), "#A9D6D1", 0.05, 0.12, vec![metals_source()]),
        catalog_material("10000000-0000-4000-8000-000000000017", "Concrete (30 MPa)", "Construction", "Generic normal-weight concrete. Linear elasticity does not capture cracking or crushing.", 2400.0, 30e9, 0.20, None, Some(3e6), Some(1.7), Some(880.0), Some(10e-6), "#8B8981", 0.0, 0.92, vec![metals_source()]),
    ]
}
