"use client";

import { useParams } from "next/navigation";
import CommandeEditeur from "../CommandeEditeur";

export default function CommandePage() {
  const params = useParams();
  return <CommandeEditeur id={params.id} />;
}
