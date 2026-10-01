import { Suspense } from "react";
import { RecordTable } from "@/components/record-table";

export default function LeadsPage() {
  return <Suspense><RecordTable kind="lead" /></Suspense>;
}
