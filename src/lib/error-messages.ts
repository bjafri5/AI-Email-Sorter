// Helper to make unsubscribe error messages user-friendly
export function friendlyUnsubscribeErrorMessage(message: string): string {
  if (message.includes("Timeout") || message.includes("timeout")) {
    return "Page took too long to load. Please try again.";
  }
  if (message.includes("No interactive elements")) {
    return "Could not find unsubscribe button. Please try again.";
  }
  if (message.includes("Navigation failed") || message.includes("net::")) {
    return "Could not reach the unsubscribe page. Please try again.";
  }
  if (message.includes("AI response")) {
    return "Something went wrong. Please try again.";
  }
  // Default: truncate long messages
  if (message.length > 100) {
    return "Unsubscribe failed. Please try again.";
  }
  return message;
}
