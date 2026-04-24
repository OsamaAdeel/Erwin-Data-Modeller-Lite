import { InputHTMLAttributes, forwardRef } from "react";
import styles from "./Input.module.scss";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ invalid, className, ...rest }, ref) => {
    const cls = [styles.input, invalid ? styles.invalid : "", className ?? ""]
      .filter(Boolean)
      .join(" ");
    return <input ref={ref} className={cls} {...rest} />;
  }
);

Input.displayName = "Input";
export default Input;
