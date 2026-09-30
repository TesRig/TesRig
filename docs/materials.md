# Material system

Materials are first-class project data stored in `project.json`. A geometry asset contains an optional
`materialId`, so STL, OBJ, and STEP imports can be assigned before a structural simulation case is
created. A material contains:

- identity, category, description, provenance, and optional `basedOn` lineage;
- density, isotropic Young's modulus and Poisson's ratio, yield and ultimate tensile strength;
- thermal conductivity, specific heat, and coefficient of thermal expansion;
- base color, metalness, roughness, and opacity for viewport rendering.

All persisted physical values use SI units: kg/m³, Pa, W/(m·K), J/(kg·K), and 1/K. MatML imports
convert common `g/cm³`, MPa, GPa, kJ/(kg·K), and microstrain/K representations to SI. CalculiX and
Abaqus input decks do not prescribe a unit system, so TesRig exports them with an explicit SI comment
and interprets imported values as SI.

## Interchange

- **MatML (`.xml`, `.matml`)** is the standards-based full-fidelity exchange. Physical properties
  use MatML `PropertyDetails`/`PropertyData`; TesRig rendering values are named unitless properties.
- **CalculiX/Abaqus (`.inp`)** reads and writes `*MATERIAL`, `*DENSITY`, `*ELASTIC`, `*PLASTIC`,
  `*EXPANSION`, `*CONDUCTIVITY`, and `*SPECIFIC HEAT`. A `TESRIG_APPEARANCE` comment preserves
  viewport appearance without affecting either solver.
- **TesRig JSON (`.json`)** is the lossless, schema-versioned library format and preserves every
  field, source, and lineage reference.

## Built-in catalog

The built-in entries are nominal room-temperature starting points, not certified design allowables.
The polymer values are especially sensitive to manufacturer, moisture, print orientation, wall/infill
strategy, and process settings. Carbon-fiber/epoxy is represented as a quasi-isotropic approximation;
a future composite model should use orthotropic lamina data and layup orientation.

Primary references used to establish the catalog and interchange model:

- [OASIS Material Markup Language specification](https://docs.oasis-open.org/materials/materials-matml-spec-pr-01.htm)
- [NIST MatML overview](https://www.nist.gov/publications/matml-xml-standardizing-web-based-materials-property-data)
- [CalculiX documentation](https://www.dhondt.de/ccx_2.22.pdf)
- [UltiMaker engineering-material data](https://ultimaker.com/materials/)
- [UltiMaker TPU 95A technical data sheet](https://um-support-files.ultimaker.com/materials/2.85mm/tds/TPU-95A/TDS-TPU95A-V2.01-250915.pdf)
- [NASA Composite Materials Handbook (CMH-17)](https://www.nasa.gov/reference/composite-materials-handbook-17/)
- [NIST Materials Data Repository](https://materialsdata.nist.gov/)

Users should duplicate the closest catalog entry and replace nominal values with the applicable
supplier datasheet, test report, specification, or design allowables for the exact material state.
