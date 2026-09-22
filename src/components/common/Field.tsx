import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
}

export function Field({ label, hint, id, ...props }: FieldProps) {
  return (
    <label className="field" htmlFor={id}>
      <span className="field__label">{label}</span>
      <input className="field__control" id={id} {...props} />
      {hint && <span className="field__hint">{hint}</span>}
    </label>
  );
}

interface TextAreaFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
}

export function TextAreaField({ label, id, ...props }: TextAreaFieldProps) {
  return (
    <label className="field" htmlFor={id}>
      <span className="field__label">{label}</span>
      <textarea className="field__control field__control--textarea" id={id} {...props} />
    </label>
  );
}
