import { InputHTMLAttributes, forwardRef } from "react";
import styles from "./Input.module.scss";

export type InputKind = "text" | "code";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  /**
   * "text" (default) renders in the sans-serif body font — right for
   *   search, filter, and prose fields.
   * "code" renders in the monospace font — right for identifier fields
   *   like table or column names where character alignment matters.
   */
  kind?: InputKind;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ invalid, kind = "text", className, ...rest }, ref) => {
    const cls = [
      styles.input,
      kind === "code" ? styles.code : "",
      invalid ? styles.invalid : "",
      className ?? "",
    ]
      .filter(Boolean)
      .join(" ");
    return <input ref={ref} className={cls} {...rest} />;
  }
);

Input.displayName = "Input";
export default Input;
