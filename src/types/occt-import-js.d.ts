declare module "occt-import-js" {
  export interface OcctImportParameters {
    linearUnit?: "millimeter" | "centimeter" | "meter" | "inch" | "foot";
    linearDeflectionType?: "bounding_box_ratio" | "absolute_value";
    linearDeflection?: number;
    angularDeflection?: number;
  }

  export interface OcctMesh {
    name: string;
    color?: [number, number, number];
    attributes: {
      position: { array: number[] };
      normal?: { array: number[] };
    };
    index: { array: number[] };
  }

  export interface OcctResult {
    success: boolean;
    meshes: OcctMesh[];
  }

  export interface OcctModule {
    ReadStepFile(content: Uint8Array, parameters: OcctImportParameters | null): OcctResult;
  }

  export interface OcctModuleOptions {
    locateFile?: (path: string) => string;
  }

  export default function createOcctModule(options?: OcctModuleOptions): Promise<OcctModule>;
}

declare module "occt-import-js/dist/occt-import-js.wasm?url" {
  const url: string;
  export default url;
}
