import type { MessageFields } from "../types/billingSettings";

type Props = {
  schoolId: string;
  prefix: string;
  values: MessageFields;
  onChange: (patch: Partial<MessageFields>) => void;
};

export default function BillingSettingsMessages({ schoolId, prefix, values, onChange }: Props) {
  return (
    <div className="billing-settings-messages">
      <div className="billing-settings-field billing-settings-field--full">
        <label className="billing-settings-label" htmlFor={`${schoolId}-${prefix}-standard-message`}>
          Standard Message
        </label>
        <textarea
          id={`${schoolId}-${prefix}-standard-message`}
          className="billing-settings-textarea"
          rows={3}
          value={values.standardMessage}
          placeholder="Enter a standard message for this document type…"
          onChange={(e) => onChange({ standardMessage: e.target.value })}
        />
      </div>

      <div className="billing-settings-field billing-settings-field--full">
        <label className="billing-settings-label" htmlFor={`${schoolId}-${prefix}-email-subject`}>
          Standard Email Subject
        </label>
        <input
          id={`${schoolId}-${prefix}-email-subject`}
          type="text"
          className="billing-settings-input"
          value={values.standardEmailSubject}
          placeholder="Enter standard email subject…"
          onChange={(e) => onChange({ standardEmailSubject: e.target.value })}
        />
      </div>

      <div className="billing-settings-field billing-settings-field--full">
        <label className="billing-settings-label" htmlFor={`${schoolId}-${prefix}-email-message`}>
          Standard Email Message
        </label>
        <div className="billing-settings-editor">
          <textarea
            id={`${schoolId}-${prefix}-email-message`}
            className="billing-settings-textarea billing-settings-textarea--editor"
            rows={5}
            value={values.standardEmailMessage}
            placeholder="Compose the standard email message…"
            onChange={(e) => onChange({ standardEmailMessage: e.target.value })}
          />
        </div>
      </div>

      <div className="billing-settings-field billing-settings-field--full">
        <label className="billing-settings-label" htmlFor={`${schoolId}-${prefix}-sms-message`}>
          Standard SMS Message
        </label>
        <textarea
          id={`${schoolId}-${prefix}-sms-message`}
          className="billing-settings-textarea"
          rows={3}
          value={values.standardSmsMessage}
          placeholder="Enter standard SMS message…"
          onChange={(e) => onChange({ standardSmsMessage: e.target.value })}
        />
      </div>
    </div>
  );
}
