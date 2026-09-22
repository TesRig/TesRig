import { invoke } from "@tauri-apps/api/core";

export async function invokeCommand<TResult, TRequest = undefined>(
  command: string,
  request?: TRequest,
): Promise<TResult> {
  return invoke<TResult>(command, request === undefined ? undefined : { request });
}
