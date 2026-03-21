import { createErrorPayload } from "@/utils/api-response";

export class ExpressError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = "ExpressError";
    this.statusCode = statusCode;
    this.payload = createErrorPayload(message);
  }
}
