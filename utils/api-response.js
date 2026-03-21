import { NextResponse } from "next/server";

export function createSuccessPayload(message, data = null) {
  return {
    success: true,
    message,
    data,
  };
}

export function createErrorPayload(message) {
  return {
    success: false,
    data: message,
  };
}

export function createSuccessResponse(message, data = null, status = 200) {
  return NextResponse.json(createSuccessPayload(message, data), { status });
}

export function createErrorResponse(message, status = 500) {
  return NextResponse.json(createErrorPayload(message), { status });
}
