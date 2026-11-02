"use client";

/* Last-resort error page (replaces the root layout, so it carries its own <html>). */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0, background: "#f5f6f8", color: "#0f172a" }}>
        <main style={{ textAlign: "center", padding: 24 }}>
          <h1 style={{ fontSize: 28 }}>The app ran into a problem</h1>
          <p style={{ fontSize: 18, color: "#475569" }}>Please reload the page. If it keeps happening, tell your administrator.</p>
          {error.digest ? <p style={{ fontSize: 14, color: "#475569" }}>Reference: {error.digest}</p> : null}
          <button type="button" onClick={reset} style={{ marginTop: 16, height: 48, padding: "0 24px", fontSize: 16, fontWeight: 600, borderRadius: 10, border: 0, background: "#1d4ed8", color: "#fff", cursor: "pointer" }}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
