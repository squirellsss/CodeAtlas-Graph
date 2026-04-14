import React from "react";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, message: String(error?.message || error || "Unknown error") };
  }

  componentDidCatch(error) {
    // Keep console logging for debugging while avoiding full-page white screen in UI.
    // eslint-disable-next-line no-console
    console.error("ErrorBoundary caught:", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-banner inspector-error">
          Inspector crashed: {this.state.message}
        </div>
      );
    }
    return this.props.children;
  }
}
