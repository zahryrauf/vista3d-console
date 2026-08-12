import { NextResponse } from "next/server";

const LABELS = [
  "aorta",
  "bladder",
  "bone lesion",
  "colon",
  "colon cancer primary",
  "duodenum",
  "heart",
  "inferior vena cava",
  "left adrenal gland",
  "left kidney",
  "left lower lobe",
  "left lung",
  "left upper lobe",
  "liver",
  "liver tumor",
  "lung tumor",
  "lung lesion",
  "kidney lesion",
  "kidney tumor",
  "pancreas",
  "prostate",
  "right adrenal gland",
  "right kidney",
  "right lower lobe",
  "right middle lobe",
  "right lung",
  "right upper lobe",
  "small bowel",
  "spleen",
  "spinal cord",
  "stomach",
  "tumor",
];

export async function GET() {
  return NextResponse.json({ source: "static", labels: [...LABELS].sort() });
}
