import { Suspense } from "react";
import { RecordTable } from "@/components/record-table";

export default function ClientsPage() {
  return <Suspense><RecordTable kind="client" /></Suspense>;
}
