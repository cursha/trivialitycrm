import type { SelectHTMLAttributes } from "react";
import { Select } from "@/components/ui/field";
import { COUNTRY_OPTIONS, canonicalCountry } from "@/lib/constants/countries";

/**
 * The Canada / USA dropdown used wherever the CRM asks for a country.
 * `defaultValue` may be any stored spelling ("canada", "USA"); it's matched
 * to the right option. A value that's neither country (an older record) is
 * kept as an extra option so saving the form doesn't wipe it.
 * `emptyLabel` adds a blank first option, e.g. "Any country" on a filter or
 * "Choose a country" on a form.
 */
export function CountrySelect({
  defaultValue,
  emptyLabel,
  ...props
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, "defaultValue" | "children"> & {
  defaultValue?: string | null;
  emptyLabel?: string;
}) {
  const current = canonicalCountry(defaultValue);
  const isOther = current !== "" && !COUNTRY_OPTIONS.some((option) => option.value === current);

  return (
    <Select defaultValue={current} {...props}>
      {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
      {COUNTRY_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
      {isOther && <option value={current}>{current}</option>}
    </Select>
  );
}
