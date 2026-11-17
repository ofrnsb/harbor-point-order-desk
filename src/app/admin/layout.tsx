import { AdminShell } from "@/components/sp/admin/AdminShell";
import { ADMIN_META } from "@/copy/app-pages";

export const metadata = { title: ADMIN_META.title };

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
