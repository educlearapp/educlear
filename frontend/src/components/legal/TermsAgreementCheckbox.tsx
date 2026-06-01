import { Link } from "react-router-dom";

import "./TermsAgreementCheckbox.css";

type TermsAgreementCheckboxProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  id?: string;
  className?: string;
};

export default function TermsAgreementCheckbox({
  checked,
  onChange,
  id = "educlear-terms-agree",
  className = "",
}: TermsAgreementCheckboxProps) {
  return (
    <label
      className={`terms-agreement-checkbox ${className}`.trim()}
      htmlFor={id}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        I agree to the{" "}
        <Link to="/terms-and-conditions" target="_blank" rel="noopener noreferrer">
          EduClear Terms &amp; Conditions
        </Link>
      </span>
    </label>
  );
}
