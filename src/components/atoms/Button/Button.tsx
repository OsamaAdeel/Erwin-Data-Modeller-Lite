import { ButtonHTMLAttributes, forwardRef } from "react";
import styles from "./Button.module.scss";

export type ButtonVariant = "primary" | "outline" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { variant = "primary", size = "md", fullWidth, className, ...rest },
    ref
  ) => {
    const cls = [
      styles.btn,
      styles[`v-${variant}`],
      styles[`s-${size}`],
      fullWidth ? styles.full : "",
      className ?? "",
    ]
      .filter(Boolean)
      .join(" ");
    return <button ref={ref} className={cls} {...rest} />;
  }
);

Button.displayName = "Button";
export default Button;
