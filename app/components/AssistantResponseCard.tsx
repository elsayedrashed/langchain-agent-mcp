"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type AssistantResponseCardProps = {
  content: string;
};

export default function AssistantResponseCard({
  content,
}: AssistantResponseCardProps) {
  return (
    <Card className="my-2 border-blue-200 border">
      <CardHeader>
        <CardTitle>Assistant</CardTitle>
      </CardHeader>
      <CardContent>
        <CardDescription className="whitespace-pre-wrap">
          {content}
        </CardDescription>
      </CardContent>
    </Card>
  );
}
