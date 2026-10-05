"use client";

import { useParams } from "next/navigation";
import ReceptionEditeur from "../ReceptionEditeur";

export default function ReceptionPage() {
  const params = useParams();
  return <ReceptionEditeur id={params.id} />;
}
