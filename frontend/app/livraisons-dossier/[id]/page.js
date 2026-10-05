"use client";

import { useParams } from "next/navigation";
import LivraisonEditeur from "../LivraisonEditeur";

export default function LivraisonPage() {
  const { id } = useParams();
  return <LivraisonEditeur id={id} />;
}
