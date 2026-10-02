/** @babel */
import RefHolder from "../models/ref-holder";
import { h } from "./view";

export function holder(value) {
  return value && typeof value.observe === "function" && typeof value.getOr === "function"
    ? value
    : RefHolder.on(value);
}

// A resource supplies its direct children with the objects it owns. There is
// no ambient context: every native child receives ordinary explicit props.
export function bindChildren(children, ownerProps) {
  if (Array.isArray(children)) return children.map((child) => bindChildren(child, ownerProps));
  if (!children || typeof children !== "object" || typeof children.tag !== "function")
    return children;
  const props = { ...children.props };
  for (const key in ownerProps) if (props[key] === undefined) props[key] = ownerProps[key];
  return h(children.tag, props, ...(children.children || []));
}
