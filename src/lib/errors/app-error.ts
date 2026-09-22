export interface NativeError {
  code?: string;
  message?: string;
}

const friendlyMessages: Record<string, string> = {
  INVALID_PROJECT_NAME: "Enter a valid project name.",
  INVALID_CASE_NAME: "Enter a valid case name.",
  PROJECT_ALREADY_EXISTS: "A project already exists at that location.",
  PROJECT_NOT_FOUND: "The selected project could not be found.",
  INVALID_PROJECT_FORMAT: "This file is not a valid TesRig project.",
  UNSUPPORTED_PROJECT_VERSION: "This project was created by an unsupported TesRig version.",
  ARCHIVE_READ_FAILED: "TesRig could not read the project archive.",
  ARCHIVE_WRITE_FAILED: "TesRig could not save the project archive.",
  CASE_NOT_FOUND: "The selected case no longer exists.",
  NO_PROJECT_OPEN: "Open a project before performing this action.",
  IO_ERROR: "A filesystem operation failed.",
  INTERNAL_ERROR: "TesRig encountered an unexpected error.",
};

export function toUserMessage(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const native = error as NativeError;
    if (native.code && friendlyMessages[native.code]) {
      return native.message || friendlyMessages[native.code];
    }
    if (native.message) return native.message;
  }

  if (typeof error === "string") return error;
  return "TesRig could not complete the operation.";
}
