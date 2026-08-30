import {
  createUiCommand,
  unwrapUiCommandResult
} from "./ui-contract.mjs";

export function createUiRuntimeClient({
  sendMessage,
  getWindowId
} = {}) {
  if (typeof sendMessage !== "function") throw new Error("UI_RUNTIME_SEND_MESSAGE_REQUIRED");
  if (typeof getWindowId !== "function") throw new Error("UI_RUNTIME_WINDOW_PROVIDER_REQUIRED");

  return Object.freeze({
    async dispatch(command, payload = {}) {
      const request = createUiCommand({
        command,
        windowId: getWindowId(),
        payload
      });
      const response = await sendMessage(request);
      return unwrapUiCommandResult(response, {
        command: request.command,
        requestId: request.requestId
      });
    }
  });
}
