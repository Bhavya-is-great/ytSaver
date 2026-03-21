import { NextResponse } from "next/server";
import { createErrorPayload } from "@/utils/api-response";
import { ExpressError } from "@/utils/expressError";

export function wraper(controller) {
  return async function wrappedRoute(request, context) {
    try {
      return await controller(request, context);
    } catch (error) {
      const logPayload = {
        route: request?.url || "unknown-route",
        method: request?.method || "unknown-method",
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : null,
      };

      if (error instanceof ExpressError) {
        console.error("[API_ERROR]", {
          ...logPayload,
          statusCode: error.statusCode,
          payload: error.payload,
        });

        return NextResponse.json(error.payload, {
          status: error.statusCode,
        });
      }

      const message = error instanceof Error ? error.message : "Unexpected server error.";

      console.error("[API_ERROR]", {
        ...logPayload,
        statusCode: 500,
      });

      return NextResponse.json(createErrorPayload(message || "Unexpected server error."), {
        status: 500,
      });
    }
  };
}
