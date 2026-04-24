import { TextareaHTMLAttributes, forwardRef } from "react";
import styles from "./Textarea.module.scss";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ invalid, className, ...rest }, ref) => {
    const cls = [styles.textarea, invalid ? styles.invalid : "", className ?? ""]
      .filter(Boolean)
      .join(" ");
    return <textarea ref={ref} className={cls} {...rest} />;
  }
);

Textarea.displayName = "Textarea";
export default Textarea;
