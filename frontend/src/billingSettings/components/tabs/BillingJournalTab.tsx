type Props = {
  schoolId: string;
};

export default function BillingJournalTab({ schoolId }: Props) {
  return (
    <section
      className="billing-settings-card billing-settings-card--compact"
      aria-labelledby="billing-settings-journal-heading"
    >
      <h2 id="billing-settings-journal-heading" className="billing-settings-card-title">
        Journal
      </h2>
      <p className="billing-settings-card-hint">
        Journal document settings will be configured here in a future release.
      </p>
      <div className="billing-settings-placeholder" id={`${schoolId}-journal-placeholder`}>
        <p className="billing-settings-placeholder-text">
          Layout, numbering, and export options for billing journals will appear in this section once the document
          engine is connected.
        </p>
      </div>
    </section>
  );
}
