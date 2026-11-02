import { StaffShell } from "@/components/staff/staff-shell";

export default function PharmacistLayout({ children }: { children: React.ReactNode }) {
  return <StaffShell roles={["PHARMACIST"]}>{() => children}</StaffShell>;
}
