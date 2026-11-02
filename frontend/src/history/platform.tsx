export type DeliveryPlatform = "uber_eats" | "doordash";
export type PlatformFilter = DeliveryPlatform | "unknown" | "";
export const platforms: { value: DeliveryPlatform; label: string }[] = [
  { value: "uber_eats", label: "Uber Eats" }, { value: "doordash", label: "DoorDash" }
];
export function platformLabel(platform?: DeliveryPlatform | null) {
  return platforms.find((item) => item.value === platform)?.label ?? "Unknown";
}
export function PlatformOptions({ filter = false, legacy = false }: { filter?: boolean; legacy?: boolean }) {
  return <><option value="" disabled={!filter && !legacy}>{filter ? "All Platforms" : legacy ? "Unknown" : "Select platform"}</option>
    {platforms.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
    {filter && <option value="unknown">Unknown</option>}</>;
}
