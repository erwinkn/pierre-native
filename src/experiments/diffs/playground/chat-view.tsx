import { useWindowSize } from "@gpuix/react";
import { Box, Label, column, row } from "../../../components/foundation";
import { copyText } from "../../../platform";
import type { PlaygroundModel } from "./model";
import { Button, Card } from "./controls";
export function ChatPanel({ model }: { model: PlaygroundModel }) {
  const narrow = useWindowSize().width < 760;
  return (
    <Card
      id="pg/chat"
      style={{
        width: narrow ? "100%" : 390,
        height: narrow ? 260 : undefined,
        padding: 16,
        gap: 12,
        flexShrink: 0,
      }}
    >
      <Label size={14}>Selected code</Label>
      <Label tone="muted">
        Select code and choose Add to chat. Your app can send these snippets to
        its own chat provider.
      </Label>
      <Box
        style={{
          ...column,
          flexGrow: 1,
          minHeight: 0,
          overflowY: "scroll",
          gap: 12,
        }}
      >
        {model.snippets.map((snippet) => (
          <Card
            key={snippet.id}
            id={"pg/snippet/" + snippet.id}
            style={{ padding: 10, gap: 8, flexShrink: 0 }}
          >
            <Box style={{ ...row, gap: 8 }}>
              <Label
                size={12}
                style={{ flexGrow: 1 }}
              >{`${snippet.filename} (${snippet.start}-${snippet.end})`}</Label>
              <Button
                id={`pg/snippet/${snippet.id}/remove`}
                label="Remove"
                icon="X"
                iconOnly
                compact
                onPress={() => model.removeSnippet(snippet.id)}
              />
            </Box>
            <Label mono size={12} style={{ lineHeight: 18 }}>
              {snippet.text}
            </Label>
            <Button
              id={`pg/snippet/${snippet.id}/copy`}
              label="Copy"
              icon="Copy"
              compact
              onPress={() => copyText(snippet.text)}
            />
          </Card>
        ))}
      </Box>
    </Card>
  );
}
