import { useEffect, useId, useRef, useState, type PointerEvent } from "react";

import { PublicAdmissionsApiError, signPublicFinancialAgreement } from "./publicAdmissionsApi";
import {
  financialAgreementMatchesCurrentDocuments,
  publishedFinancialDocuments,
} from "./reviewReadiness";
import type { ApplicantApplicationView, PublicAdmissionsConfig } from "./publicAdmissionsTypes";

type Props = {
  publicSlug: string;
  publicAccessId: string;
  accessToken: string;
  config: PublicAdmissionsConfig | null;
  application: ApplicantApplicationView;
  onSigned: (application: ApplicantApplicationView) => void;
  onSessionInvalid: () => void;
};

function payerName(application: ApplicantApplicationView): string | null {
  const payers = (application.guardians || []).filter((guardian) => guardian.isPayingPerson);
  if (payers.length !== 1) return null;
  return `${payers[0].firstName} ${payers[0].surname}`.replace(/\s+/g, " ").trim();
}

export default function PublicAdmissionsFinancialAgreement({
  publicSlug,
  publicAccessId,
  accessToken,
  config,
  application,
  onSigned,
  onSessionInvalid,
}: Props) {
  const formId = useId();
  const documents = publishedFinancialDocuments(config);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const moved = useRef(false);
  const [strokeCount, setStrokeCount] = useState(0);
  const [policyAccepted, setPolicyAccepted] = useState(false);
  const [declarationAccepted, setDeclarationAccepted] = useState(false);
  const [typedName, setTypedName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const responsibleName = payerName(application);
  const signed = financialAgreementMatchesCurrentDocuments(application, config);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "#111111";
    context.lineWidth = 2.5;
    context.lineCap = "round";
    context.lineJoin = "round";
  }, [documents]);

  if (!documents) return null;

  function pointFromEvent(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
    };
  }

  function clearSignature() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "#111111";
    context.lineWidth = 2.5;
    setStrokeCount(0);
    moved.current = false;
  }

  async function handleSign() {
    if (signing) return;
    setError(null);
    if (!policyAccepted || !declarationAccepted) {
      setError("Confirm that you have read and accept both documents.");
      return;
    }
    if (!responsibleName) {
      setError("Exactly one guardian must be marked Responsible for fees.");
      return;
    }
    if (strokeCount < 1) {
      setError("Draw your signature before signing. A checkbox is not a signature.");
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) {
      setError("Could not read the signature.");
      return;
    }
    setSigning(true);
    try {
      const updated = await signPublicFinancialAgreement(
        publicSlug,
        publicAccessId,
        accessToken,
        {
          policyAccepted,
          declarationAccepted,
          typedSignerName: typedName,
          strokeCount,
          signature: blob,
        }
      );
      onSigned(updated);
      clearSignature();
      setPolicyAccepted(false);
      setDeclarationAccepted(false);
    } catch (err) {
      if (err instanceof PublicAdmissionsApiError && err.status === 404) {
        onSessionInvalid();
        return;
      }
      setError(err instanceof Error ? err.message : "Could not sign the financial agreement.");
    } finally {
      setSigning(false);
    }
  }

  return (
    <section className="pa-card" aria-labelledby={`${formId}-financial`} data-testid="pa-financial-agreement">
      <h3 id={`${formId}-financial`} className="pa-subsection-title">
        Financial agreement
      </h3>
      <p className="pa-body" data-testid="pa-financial-responsible">
        Responsible for fees: {responsibleName || "Mark exactly one guardian as responsible for fees."}
      </p>
      <p className="pa-body" data-testid="pa-financial-status">
        {signed
          ? "Signed for the current financial policy and declaration."
          : "Not signed. Read both documents, type the responsible guardian’s full name, and draw a signature."}
      </p>
      {documents.map((document) => (
        <details key={document.id} open>
          <summary>
            {document.title} ({document.version})
          </summary>
          <div className="pa-declaration-box">
            <p className="pa-body" style={{ whiteSpace: "pre-wrap" }}>
              {document.body}
            </p>
          </div>
          <label className="pa-check">
            <input
              type="checkbox"
              checked={document.kind === "FINANCIAL_POLICY" ? policyAccepted : declarationAccepted}
              onChange={(event) => {
                if (document.kind === "FINANCIAL_POLICY") setPolicyAccepted(event.target.checked);
                else setDeclarationAccepted(event.target.checked);
              }}
              data-testid={`pa-financial-accept-${document.kind}`}
            />
            <span>I have read and accept {document.title}.</span>
          </label>
        </details>
      ))}
      <div className="pa-field">
        <label htmlFor={`${formId}-typed-name`}>Type the responsible guardian’s full name</label>
        <input
          id={`${formId}-typed-name`}
          value={typedName}
          onChange={(event) => setTypedName(event.target.value)}
          autoComplete="name"
          data-testid="pa-financial-typed-name"
        />
      </div>
      <div className="pa-field">
        <span className="pa-body">Draw your signature</span>
        <canvas
          ref={canvasRef}
          width={560}
          height={160}
          data-testid="pa-financial-signature"
          style={{ display: "block", width: "100%", maxWidth: 560, height: 160, border: "1px solid rgba(0,0,0,0.2)", background: "#fff", touchAction: "none" }}
          onPointerDown={(event) => {
            const point = pointFromEvent(event);
            const context = canvasRef.current?.getContext("2d");
            if (!point || !context) return;
            drawing.current = true;
            moved.current = false;
            context.beginPath();
            context.moveTo(point.x, point.y);
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (!drawing.current) return;
            const point = pointFromEvent(event);
            const context = canvasRef.current?.getContext("2d");
            if (!point || !context) return;
            context.lineTo(point.x, point.y);
            context.stroke();
            moved.current = true;
          }}
          onPointerUp={() => {
            if (drawing.current && moved.current) setStrokeCount((count) => count + 1);
            drawing.current = false;
          }}
        />
        <button type="button" className="pa-secondary-btn" onClick={clearSignature} data-testid="pa-financial-signature-clear">
          Clear signature
        </button>
      </div>
      {error ? (
        <p className="pa-banner-error" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        className="pa-secondary-btn"
        disabled={signing}
        onClick={() => void handleSign()}
        data-testid="pa-financial-sign"
      >
        {signing ? "Signing…" : "Sign financial agreement"}
      </button>
    </section>
  );
}
