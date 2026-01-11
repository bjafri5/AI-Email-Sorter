// Helper to make unsubscribe error messages user-friendly
export function friendlyUnsubscribeErrorMessage(message: string): string {
  // Website blocking automated access - suggest manual unsubscribe
  if (message.includes("ERR_HTTP2_PROTOCOL_ERROR") ||
      message.includes("ERR_CONNECTION_RESET") ||
      message.includes("ERR_CONNECTION_REFUSED")) {
    return "This website is blocking automated unsubscribe. Please unsubscribe manually.";
  }
  // Timeout errors
  if (message.includes("Timeout") || message.includes("timeout")) {
    return "Page took too long to load. Please try again.";
  }
  // Other network errors
  if (message.includes("Navigation failed") || message.includes("net::ERR_")) {
    return "Could not reach the unsubscribe page. Please try again.";
  }
  // No interactive elements found
  if (message.includes("No interactive elements")) {
    return "Could not find unsubscribe button. Please try again.";
  }
  // AI parsing errors
  if (message.includes("AI response")) {
    return "Something went wrong. Please try again.";
  }
  // Default: truncate long messages
  if (message.length > 100) {
    return "Unsubscribe failed. Please try again.";
  }
  return message;
}
