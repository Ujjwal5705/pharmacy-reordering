import { StaffShell } from "@/components/staff/staff-shell";

export default function OpsLayout({ children }: { children: React.ReactNode }) {
  return <StaffShell roles={["OPS_ADMIN"]}>{() => children}</StaffShell>;
}
