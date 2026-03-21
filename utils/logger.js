const isProduction = process.env.NODE_ENV === "production";

export function logInfo(label, payload) {
  if (!isProduction) {
    console.log(label, payload);
  }
}

export function logWarn(label, payload) {
  if (!isProduction) {
    console.warn(label, payload);
  }
}

export function logError(label, payload) {
  console.error(label, payload);
}
