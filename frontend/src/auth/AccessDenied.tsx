import "./AccessDenied.css";

import type { MigrationAccessDeniedDebug } from "./migrationAccess";

type Props = {
  message?: string;
  debug?: MigrationAccessDeniedDebug;
};

export default function AccessDenied({ message = "Access denied.", debug }: Props) {
  return (
    <div className="access-denied" role="alert">
      <p className="access-denied__message">{message}</p>
      {debug ? (
        <pre className="access-denied__debug">
          {JSON.stringify(debug, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}
