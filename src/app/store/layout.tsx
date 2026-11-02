import { StaffShell } from "@/components/staff/staff-shell";

export default function StoreLayout({ children }: { children: React.ReactNode }) {
  return <StaffShell roles={["STORE_STAFF", "OPS_ADMIN"]}>{() => children}</StaffShell>;
}
