export function ErrorPanel({ error }: { error: Error }) {
  const title = /webgl/i.test(error.message)
    ? "WebGL is unavailable on this device"
    : "The 3D view could not start";
  return (
    <div role="alert" className="nx-error">
      <div className="nx-error-block">
        <h1 className="nx-error-title">
          <span className="nx-error-dot" aria-hidden="true" />
          {title}
        </h1>
        <p className="nx-error-text">
          Reload to try again. If it keeps happening, restart the app.
        </p>
        <button type="button" className="nx-error-button" onClick={() => location.reload()}>
          Reload
        </button>
        {import.meta.env.DEV && (
          <pre data-testid="error-detail" className="nx-error-detail">
            {error.message}
          </pre>
        )}
      </div>
    </div>
  );
}
