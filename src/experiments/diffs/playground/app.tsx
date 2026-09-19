import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { useGpuixRequired, useWindowSize } from "@gpuix/react";
import {
  UIProvider,
  Box,
  Label,
  Input,
  Part,
  row,
  column,
  useUI,
} from "../../../components/foundation";
import {
  File,
  FileDiff,
  CodeView,
  type CommonCodeProps,
  type CodeViewItem,
  type DiffOptions,
  type FileDiffMetadata,
} from "../../../diffs";
import { copyText } from "../../../platform";
import { PlaygroundModel, EXAMPLES, fixtures, type Comment } from "./model";
import {
  Button,
  Menu,
  Toggle,
  Segments,
  Divider,
  Card,
  Icon,
  OptionsDialog,
} from "./controls";
import {
  codeThemes,
  DARK_THEMES,
  LIGHT_THEMES,
  ensurePlaygroundFonts,
  playgroundTheme,
} from "./theme";
import alexAvatarPath from "../../../../assets/playground/avatar_fat.jpg" with { type: "file" };
import markAvatarPath from "../../../../assets/playground/avatar_mdo.jpg" with { type: "file" };
const [alexAvatar, markAvatar] = await Promise.all(
  [alexAvatarPath, markAvatarPath].map(imageAsset),
);
import { ChatPanel } from "./chat-view";
import { imageAsset } from "../../../platform";
const views = [
  { value: "diff", label: "Diff" },
  { value: "file", label: "File" },
  { value: "virtualizer", label: "Virtualizer (win)" },
  { value: "virtualizer-element", label: "Virtualizer (el)" },
  { value: "codeview", label: "CodeView" },
] as const;
const inline = [
  { value: "word-alt", label: "Word-Alt" },
  { value: "word", label: "Word" },
  { value: "char", label: "Character" },
  { value: "none", label: "None" },
] as const;
const hunks = [
  { value: "line-info", label: "Line-Info" },
  { value: "line-info-basic", label: "Line-Info-Basic" },
  { value: "simple", label: "Simple" },
  { value: "metadata", label: "Metadata" },
] as const;
const hover = [
  { value: "disabled", label: "Disabled" },
  { value: "both", label: "Line & number" },
  { value: "number", label: "Number" },
  { value: "line", label: "Line" },
] as const;
const wrapRow = { ...row, flexWrap: "wrap" as const, gap: 12 };

function EditorActions({ model }: { model: PlaygroundModel }) {
  const editor = model.current,
    direct =
      ["file", "diff"].includes(model.state.viewMode) ||
      model.state.example !== "playground";
  return (
    <Box style={{ ...row, gap: 8 }}>
      <Button
        id="pg/find"
        label="Find"
        icon="Search"
        disabled={!direct}
        onPress={() => editor.runCommand("openSearchPanel")}
      />
      <Button
        id="pg/replace"
        label="Replace"
        icon="Replace"
        disabled={!direct}
        onPress={() => {
          if (editor.options.readOnly) model.beginEdit(editor);
          if (editor.search.mode) editor.setSearchMode("replace");
          else editor.runCommand("openSearchReplacePanel");
        }}
      />
      <Button
        id="pg/undo"
        label="Undo"
        icon="ArrowShort"
        disabled={!editor.canUndo || editor.options.readOnly || !direct}
        onPress={() => editor.undo()}
      />
      <Button
        id="pg/redo"
        label="Redo"
        icon="ArrowRightShort"
        disabled={!editor.canRedo || editor.options.readOnly || !direct}
        onPress={() => editor.redo()}
      />
      <Button
        id="pg/reset"
        label="Reset"
        icon="Refresh"
        disabled={!direct}
        onPress={() => model.resetCurrent()}
      />
    </Box>
  );
}
function Controls({
  model,
  share = true,
}: {
  model: PlaygroundModel;
  share?: boolean;
}) {
  const s = model.state;
  const shareLink = async () => {
    await copyText(model.link());
    model.update({ notice: "Link copied." });
  };
  return (
    <Part
      component="playground"
      name="Controls"
      id="pg/controls"
      style={{ ...column, gap: 16, flexShrink: 0 }}
    >
      <Box style={wrapRow}>
        <Menu
          id="pg/view"
          value={s.viewMode}
          items={views}
          icon="Layers"
          onChange={(value) =>
            model.update({
              viewMode: value,
              example: "playground",
              selectedRange: null,
              edit: !(value === "diff" ? model.diff : model.file).options
                .readOnly,
            })
          }
        />
        <Divider />
        <Segments
          id="pg/layout"
          value={s.diffStyle}
          onChange={(v) => model.update({ diffStyle: v })}
          items={[
            { value: "split", label: "split", icon: "DiffSplit" },
            { value: "unified", label: "unified", icon: "DiffUnified" },
          ]}
        />
        <Divider />
        <Menu
          id="pg/light-theme"
          value={s.lightTheme}
          items={LIGHT_THEMES.map((value) => ({ value, label: value }))}
          icon="ColorLight"
          onChange={(lightTheme) => model.update({ lightTheme })}
        />
        <Menu
          id="pg/dark-theme"
          value={s.darkTheme}
          items={DARK_THEMES.map((value) => ({ value, label: value }))}
          icon="ColorDark"
          onChange={(darkTheme) => model.update({ darkTheme })}
        />
        <Segments
          id="pg/color"
          value={s.colorMode}
          onChange={(colorMode) => model.update({ colorMode })}
          items={[
            { value: "system", label: "system", icon: "ColorAuto" },
            { value: "light", label: "light", icon: "ColorLight" },
            { value: "dark", label: "dark", icon: "ColorDark" },
          ]}
        />
        <Divider />
        <Segments
          id="pg/indicators"
          value={s.diffIndicators}
          onChange={(diffIndicators) => model.update({ diffIndicators })}
          items={[
            { value: "bars", label: "bars", icon: "CodeStyleBars" },
            { value: "classic", label: "classic", icon: "SymbolDiffstat" },
            { value: "none", label: "none", icon: "Paragraph" },
          ]}
        />
        <Divider />
        <Menu
          id="pg/inline"
          value={s.lineDiffType}
          items={inline}
          icon="CodeStyleInline"
          onChange={(lineDiffType) => model.update({ lineDiffType })}
        />
        {share && (
          <>
            <Box style={{ flexGrow: 1 }} />
            <Button
              id="pg/copy-link"
              label="Copy link"
              icon="Link"
              onPress={shareLink}
            />
          </>
        )}
      </Box>
      <Box style={wrapRow}>
        <Toggle
          id="pg/background"
          label="Backgrounds"
          icon="CodeStyleBg"
          checked={!s.disableBackground}
          onChange={(v) => model.update({ disableBackground: !v })}
        />
        <Toggle
          id="pg/line-numbers"
          label="Line numbers"
          icon="ListOrdered"
          checked={!s.disableLineNumbers}
          onChange={(v) => model.update({ disableLineNumbers: !v })}
        />
        <Toggle
          id="pg/wrap"
          label="Wrap"
          icon="WordWrap"
          checked={s.overflow === "wrap"}
          onChange={(v) => model.update({ overflow: v ? "wrap" : "scroll" })}
        />
        <Toggle
          id="pg/annotations"
          label="Annotations"
          icon="InReview"
          checked={s.showAnnotations}
          onChange={(showAnnotations) => model.update({ showAnnotations })}
        />
        <Toggle
          id="pg/selection-actions"
          label="Selection actions"
          icon="CommentFill"
          checked={s.selectionActions}
          onChange={(selectionActions) => model.update({ selectionActions })}
        />
        <Toggle
          id="pg/markers"
          label="Markers"
          icon="CiWarning"
          checked={s.showMarkers}
          disabled={
            s.example !== "playground" || !!model.current.options.readOnly
          }
          onChange={(showMarkers) => model.update({ showMarkers })}
        />
        <Menu
          id="pg/hunks"
          value={s.hunkSeparators}
          items={hunks}
          icon="HunkDivider"
          onChange={(hunkSeparators) => model.update({ hunkSeparators })}
        />
      </Box>
      <Box style={wrapRow}>
        <Menu
          id="pg/hover"
          label={
            "Line hover: " +
            hover.find((h) => h.value === s.lineHoverHighlight)!.label
          }
          value={s.lineHoverHighlight}
          items={hover}
          icon="Eye"
          onChange={(lineHoverHighlight) =>
            model.update({ lineHoverHighlight })
          }
        />
        <Divider />
        <Toggle
          id="pg/comment-buttons"
          label="Comment buttons"
          icon="CommentFill"
          checked={s.enableGutterUtility}
          onChange={() =>
            model.update({ enableGutterUtility: !s.enableGutterUtility })
          }
        />
        <Toggle
          id="pg/line-selection"
          label="Line selection"
          icon="Cursor"
          checked={s.enableLineSelection}
          onChange={() =>
            model.update({
              enableLineSelection: !s.enableLineSelection,
              selectedRange: null,
            })
          }
        />
        {s.enableLineSelection && (
          <Label size={12} mono tone="muted">
            {s.selectedRange
              ? "Selected: L" +
                s.selectedRange.start +
                "-" +
                s.selectedRange.end
              : "Nothing selected…"}
          </Label>
        )}
        {s.selectedRange && (
          <Button
            id="pg/clear-lines"
            label="Clear line selection"
            icon="XSquircle"
            onPress={() => model.update({ selectedRange: null })}
          />
        )}
        <Box style={{ flexGrow: 1 }} />
        <Menu
          id="pg/examples"
          label={
            s.example === "playground"
              ? "Edit examples"
              : EXAMPLES.find((e) => e.value === s.example)!.label
          }
          value={s.example}
          items={EXAMPLES}
          icon="Code"
          onChange={(example) => model.setExample(example)}
        />
        <EditorActions model={model} />
      </Box>
    </Part>
  );
}
function Thread({
  comment,
  model,
}: {
  comment: Comment;
  model: PlaygroundModel;
}) {
  const { theme } = useUI(),
    width = useWindowSize().width;
  const [draft, setDraft] = useState(comment.body),
    [replying, setReplying] = useState(false),
    [reply, setReply] = useState("");
  return (
    <Part
      component="playground"
      name="Comment"
      id={"pg/comment/" + comment.id}
      style={{
        ...column,
        margin: 10,
        padding: 12,
        gap: 16,
        width: width < 640 ? "95%" : "70%",
        borderWidth: 1,
        borderRadius: 8,
        borderColor: theme.colors.line,
        backgroundColor: theme.colors.surface,
      }}
    >
      <Box style={{ ...row, alignItems: "flex-start", gap: 8 }}>
        <Part
          component="playground"
          name="Avatar"
          id={"pg/comment/" + comment.id + "/avatar"}
          as="img"
          nativeProps={{
            src: alexAvatar,
            alt: comment.example ? "Alex" : "You",
          }}
          style={{ width: 24, height: 24, borderRadius: 12, flexShrink: 0 }}
        />
        <Box style={{ ...column, gap: 0, flexGrow: 1, minWidth: 0 }}>
          {comment.draft ? (
            <Input
              id={"pg/comment/" + comment.id + "/input"}
              value={draft}
              onChange={setDraft}
              multiline
              placeholder="Leave a comment…"
              minRows={3}
            />
          ) : (
            <>
              <Box style={{ ...row, gap: 8 }}>
                <Label size={14} style={{ fontWeight: 600 }}>
                  {comment.example ? "Alex" : "You"}
                </Label>
                <Label size={13} tone="muted">
                  {comment.example ? "2h ago" : "just now"}
                </Label>
              </Box>
              <Label size={13} style={{ lineHeight: 21 }}>
                {comment.body}
              </Label>
            </>
          )}
        </Box>
      </Box>
      {comment.replies.map((body, i) => (
        <Box
          key={i}
          style={{ ...row, gap: 8, marginLeft: 32, alignItems: "flex-start" }}
        >
          <Part
            component="playground"
            name="Avatar"
            id={"pg/comment/" + comment.id + "/reply-avatar/" + i}
            as="img"
            nativeProps={{
              src: markAvatar,
              alt: comment.example ? "Mark" : "You",
            }}
            style={{ width: 24, height: 24, borderRadius: 12 }}
          />
          <Box style={{ ...column, gap: 0, flexGrow: 1, minWidth: 0 }}>
            <Box style={{ ...row, gap: 8 }}>
              <Label size={13} style={{ fontWeight: 600 }}>
                {comment.example && i === 0 ? "Mark" : "You"}
              </Label>
              {comment.example && i === 0 && (
                <Label size={14} tone="muted">
                  1h ago
                </Label>
              )}
            </Box>
            <Label size={13} style={{ lineHeight: 21 }}>
              {body}
            </Label>
          </Box>
        </Box>
      ))}
      {replying && (
        <Input
          id={"pg/comment/" + comment.id + "/reply-input"}
          value={reply}
          onChange={setReply}
          multiline
          placeholder="Add a reply…"
          minRows={2}
        />
      )}
      <Box style={{ ...row, marginLeft: 32, gap: 16, flexWrap: "wrap" }}>
        {comment.draft ? (
          <>
            <Button
              id={"pg/comment/" + comment.id + "/submit"}
              label="Comment"
              compact
              onPress={() =>
                draft.trim()
                  ? model.changeComment(comment.id, {
                      body: draft.trim(),
                      draft: false,
                    })
                  : model.deleteComment(comment.id)
              }
            />
            <Button
              id={"pg/comment/" + comment.id + "/cancel"}
              label="Cancel"
              compact
              onPress={() => model.deleteComment(comment.id)}
            />
          </>
        ) : (
          <>
            <Button
              id={"pg/comment/" + comment.id + "/reply"}
              style={{
                height: 20,
                padding: 0,
                paddingLeft: 0,
                paddingRight: 0,
                borderWidth: 0,
                backgroundColor: "#00000000",
                color: "#60a5fa",
              }}
              label={replying ? "Send reply" : "Add reply…"}
              compact
              onPress={() => {
                if (replying && reply.trim()) {
                  model.changeComment(comment.id, {
                    replies: [...comment.replies, reply.trim()],
                  });
                  setReply("");
                  setReplying(false);
                } else setReplying(true);
              }}
            />
            <Button
              id={"pg/comment/" + comment.id + "/resolve"}
              style={{
                height: 20,
                padding: 0,
                paddingLeft: 0,
                paddingRight: 0,
                borderWidth: 0,
                backgroundColor: "#00000000",
                color: "#60a5fa",
              }}
              label={comment.resolved ? "Reopen" : "Resolve"}
              compact
              onPress={() =>
                model.changeComment(comment.id, { resolved: !comment.resolved })
              }
            />
            <Button
              id={"pg/comment/" + comment.id + "/delete"}
              style={{
                height: 20,
                padding: 0,
                paddingLeft: 0,
                paddingRight: 0,
                borderWidth: 0,
                backgroundColor: "#00000000",
                color: "#f87171",
              }}
              label="Delete"
              compact
              onPress={() => model.deleteComment(comment.id)}
            />
          </>
        )}
      </Box>
    </Part>
  );
}
function SelectionAction({
  editor,
  model,
}: {
  editor: PlaygroundModel["current"];
  model: PlaygroundModel;
}) {
  return (
    <Box style={{ ...row, gap: 4, padding: 4 }}>
      <Button
        id="pg/add-to-chat"
        label="Add to chat"
        icon="CommentFill"
        compact
        onPress={() => model.addSnippet(editor)}
        style={{ backgroundColor: "#6366f1", borderWidth: 0, color: "#ffffff" }}
      />
      <Button
        id="pg/copy-selection"
        label="Copy"
        icon="Copy"
        compact
        onPress={() => editor.copy()}
      />
    </Box>
  );
}
function Shortcuts({
  model,
  options,
}: {
  model: PlaygroundModel;
  options: DiffOptions;
}) {
  const { theme } = useUI(),
    s = model.state;
  return (
    <Card id="pg/shortcuts" style={{ height: "100%" }}>
      <Box
        style={{
          ...row,
          flexWrap: "wrap",
          gap: 12,
          padding: 16,
          borderBottomWidth: 1,
          borderColor: theme.colors.line,
          flexShrink: 0,
        }}
      >
        {!s.shortcutsJSON && (
          <Box style={{ width: 420, maxWidth: "100%" }}>
            <Input
              id="pg/shortcut-search"
              placeholder="Search shortcuts…"
              value={s.shortcutQuery}
              onChange={(shortcutQuery) => model.update({ shortcutQuery })}
            />
          </Box>
        )}
        <Label size={12} tone="muted">
          {model.shortcutRows.length + " of 33 bindings"}
        </Label>
        <Box style={{ flexGrow: 1 }} />
        {s.shortcutsJSON && (
          <Button
            id="pg/apply-keymap"
            label="Apply keymap"
            icon="Check"
            onPress={() => model.applyKeymap()}
          />
        )}
        <Button
          id="pg/shortcut-mode"
          label={s.shortcutsJSON ? "Back to shortcuts" : "Edit in JSON"}
          icon="Code"
          onPress={() => model.update({ shortcutsJSON: !s.shortcutsJSON })}
        />
      </Box>
      {s.keymapError && (
        <Label size={13} tone="red" style={{ padding: 12 }}>
          {s.keymapError}
        </Label>
      )}
      {s.shortcutsJSON ? (
        <Box style={{ ...column, flexGrow: 1, minHeight: 0 }}>
          <File
            id="pg/keymap-editor"
            file={model.keymap.getFile()}
            editor={model.keymap}
            options={{ ...options, disableFileHeader: true }}
          />
        </Box>
      ) : (
        <Box
          style={{ ...column, overflowY: "scroll", flexGrow: 1, minHeight: 0 }}
        >
          <Box
            style={{
              ...row,
              padding: 16,
              backgroundColor: theme.colors.surface,
            }}
          >
            <Label size={14} style={{ width: "33%" }}>
              Shortcut
            </Label>
            <Label size={14} style={{ width: "25%" }}>
              Command
            </Label>
            <Label size={14}>Action</Label>
          </Box>
          {["all", "mac", "linux", "windows"].map((platform) => {
            const rows = model.shortcutRows.filter(
              (r) => r.platform === platform,
            );
            return rows.length ? (
              <Box key={platform} style={column}>
                <Label
                  size={11}
                  tone="muted"
                  style={{
                    paddingLeft: 16,
                    paddingTop: 8,
                    paddingBottom: 8,
                    backgroundColor: theme.colors.surface,
                  }}
                >
                  {(
                    {
                      all: "ALL PLATFORMS",
                      mac: "macOS",
                      linux: "Linux",
                      windows: "Windows",
                    } as Record<string, string>
                  )[platform] +
                    " · " +
                    rows.length +
                    " bindings"}
                </Label>
                {rows.map((r) => (
                  <Box
                    key={r.shortcut}
                    style={{
                      ...row,
                      minHeight: 42,
                      gap: 8,
                      paddingLeft: 16,
                      paddingRight: 16,
                      borderTopWidth: 1,
                      borderColor: theme.colors.line,
                    }}
                  >
                    <Box
                      style={{
                        ...row,
                        width: "33%",
                        flexWrap: "wrap",
                        gap: 4,
                        paddingTop: 6,
                        paddingBottom: 6,
                      }}
                    >
                      {r.shortcut.split("+").map((key, index) => (
                        <Label
                          key={index}
                          size={11}
                          mono
                          style={{
                            paddingLeft: 5,
                            paddingRight: 5,
                            lineHeight: 20,
                            borderWidth: 1,
                            borderColor: theme.colors.line,
                            borderRadius: 4,
                            backgroundColor: theme.colors.surface,
                          }}
                        >
                          {(
                            {
                              cmdOrCtrl: "Cmd/Ctrl",
                              cmd: "Cmd",
                              ctrl: "Ctrl",
                              alt: "Alt",
                              shift: "Shift",
                              ArrowUp: "↑",
                              ArrowDown: "↓",
                              ArrowLeft: "←",
                              ArrowRight: "→",
                              Escape: "Esc",
                            } as Record<string, string>
                          )[key] ??
                            (key.length === 1 ? key.toUpperCase() : key)}
                        </Label>
                      ))}
                    </Box>
                    <Label size={12} mono tone="muted" style={{ width: "25%" }}>
                      {r.command}
                    </Label>
                    <Label size={13} style={{ flexGrow: 1, minWidth: 0 }}>
                      {r.action}
                    </Label>
                  </Box>
                ))}
              </Box>
            ) : null;
          })}
          {!model.shortcutRows.length && (
            <Label size={14} tone="muted" style={{ padding: 20 }}>
              No matching shortcuts.
            </Label>
          )}
        </Box>
      )}
    </Card>
  );
}
function ExampleView({
  model,
  options,
  common,
}: {
  model: PlaygroundModel;
  options: DiffOptions;
  common: CommonCodeProps;
}) {
  const width = useWindowSize().width,
    s = model.state;
  if (s.example === "shortcuts")
    return <Shortcuts model={model} options={options} />;
  if (s.example === "carets")
    return (
      <Box
        style={{
          ...row,
          alignItems: "stretch",
          flexDirection: width < 760 ? "column" : "row",
          gap: 16,
          height: "100%",
          minHeight: 0,
        }}
      >
        {model.peers.map((editor, i) => (
          <Card
            key={i}
            id={"pg/peer-card/" + i}
            style={{ flexGrow: 1, flexBasis: 0 }}
          >
            <File
              id={"pg/peer/" + i}
              file={fixtures.caretFile}
              editor={editor}
              options={options}
              renderHeaderMetadata={() => (
                <Box style={{ ...row, gap: 8 }}>
                  <Box
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      backgroundColor: fixtures.carets[i].metadata.color,
                    }}
                  />
                  <Label size={12} tone="muted">
                    {"Editing as " + fixtures.carets[i].metadata.name}
                  </Label>
                </Box>
              )}
            />
          </Card>
        ))}
      </Box>
    );
  const editor = model.current;
  if (s.example === "history")
    return (
      <Box style={{ ...column, height: "100%", gap: 16, minHeight: 0 }}>
        <Box style={{ ...row, gap: 8, flexShrink: 0 }}>
          <Button
            id="pg/history/start"
            label="First step"
            icon="ArrowLeftBar"
            disabled={model.historyStep <= 0}
            onPress={() => model.jumpHistory(0)}
          />
          <Button
            id="pg/history/undo"
            label="Undo"
            icon="ArrowShort"
            disabled={!editor.canUndo}
            onPress={() => editor.undo()}
          />
          <Button
            id="pg/history/redo"
            label="Redo"
            icon="ArrowRightShort"
            disabled={!editor.canRedo}
            onPress={() => editor.redo()}
          />
          <Button
            id="pg/history/end"
            label="Last step"
            icon="ArrowRightBar"
            disabled={model.historyStep < 0 || model.historyStep === 7}
            onPress={() => model.jumpHistory(7)}
          />
          <Box style={{ flexGrow: 1 }} />
          <Label size={12} tone="muted">
            {model.historyStep < 0
              ? "Custom edits"
              : model.historyStep + "/7 steps"}
          </Label>
        </Box>
        <Box
          style={{
            ...row,
            alignItems: "stretch",
            gap: 32,
            flexGrow: 1,
            minHeight: 0,
            flexDirection: width < 760 ? "column" : "row",
          }}
        >
          <Card id="pg/history-card" style={{ flexGrow: 1, flexBasis: 0 }}>
            <File
              id="pg/history-editor"
              file={fixtures.historyFile}
              editor={editor}
              options={options}
            />
          </Card>
          <Card
            id="pg/history-steps"
            style={{
              width: width < 760 ? "100%" : 290,
              flexShrink: 0,
              alignSelf: "flex-start",
              padding: 4,
              gap: 0,
            }}
          >
            {fixtures.historyEdits.map((step, i) => (
              <Button
                key={step.label}
                id={"pg/history/step/" + (i + 1)}
                label={step.label}
                disabled={model.historyStep < 0}
                onPress={() => model.jumpHistory(i + 1)}
                style={{
                  height: 44,
                  borderWidth: 0,
                  backgroundColor: "#00000000",
                  width: "100%",
                }}
              >
                <Icon
                  name={model.historyStep > i ? "Approved" : "InReview"}
                  color={model.historyStep > i ? "#00df70" : "#737373"}
                />
                <Label size={14}>{step.label}</Label>
              </Button>
            ))}
          </Card>
        </Box>
      </Box>
    );
  return (
    <Box
      style={{
        ...row,
        alignItems: "stretch",
        gap: 16,
        height: "100%",
        minHeight: 0,
        flexDirection: width < 760 ? "column" : "row",
      }}
    >
      <Card id="pg/example-card" style={{ flexGrow: 1, flexBasis: 0 }}>
        <File
          {...common}
          id={"pg/" + s.example + "-editor"}
          file={
            s.example === "selection"
              ? fixtures.selectionFile
              : fixtures.findFile
          }
          editor={editor}
          options={options}
        />
      </Card>
      {s.example === "selection" && <ChatPanel model={model} />}
    </Box>
  );
}
export function PlaygroundApp({
  model,
  systemMode = "dark",
}: {
  model: PlaygroundModel;
  systemMode?: "light" | "dark";
}) {
  useSyncExternalStore(model.subscribe, model.getSnapshot);
  const native = useGpuixRequired();
  ensurePlaygroundFonts(native);
  const size = useWindowSize(),
    s = model.state;
  const [optionsOpen, setOptionsOpen] = useState(false);
  const light =
    s.colorMode === "light" ||
    (s.colorMode === "system" && systemMode === "light");
  const theme = useMemo(
    () => playgroundTheme(systemMode === "light"),
    [systemMode],
  );
  const codeTheme = codeThemes[light ? s.lightTheme : s.darkTheme];
  const options = useMemo<DiffOptions>(
    () => ({
      theme: codeTheme,
      themeType: light ? "light" : "dark",
      diffStyle: s.diffStyle,
      diffIndicators: s.diffIndicators,
      lineDiffType: s.lineDiffType,
      lineHoverHighlight: s.lineHoverHighlight,
      hunkSeparators: s.hunkSeparators,
      disableBackground: s.disableBackground,
      disableLineNumbers: s.disableLineNumbers,
      overflow: s.overflow,
      fontSize: 13,
      lineHeight: 20,
    }),
    [
      codeTheme,
      light,
      s.diffStyle,
      s.diffIndicators,
      s.lineDiffType,
      s.lineHoverHighlight,
      s.hunkSeparators,
      s.disableBackground,
      s.disableLineNumbers,
      s.overflow,
    ],
  );
  const comments = model.comments[model.commentKey];
  const annotations = useMemo(
    () =>
      s.showAnnotations
        ? comments
            .filter((c) => !c.resolved)
            .map((c) => ({
              side: c.side,
              lineNumber: c.lineNumber,
              metadata: c,
            }))
        : [],
    [comments, s.showAnnotations],
  );
  const renderAnnotation = useCallback(
    (annotation: any) => <Thread comment={annotation.metadata} model={model} />,
    [model],
  );
  const common: CommonCodeProps = {
    options,
    selectedLines: s.selectedRange,
    enableLineSelection: s.enableLineSelection,
    onLineSelect: s.enableLineSelection
      ? (range) => model.update({ selectedRange: range })
      : undefined,
    onRequestEdit: (editor) => model.beginEdit(editor),
    getAnnotationKey: (annotation) => annotation.metadata.id,
    renderAnnotation,
    renderGutterUtility: s.enableGutterUtility
      ? (line) => (
          <Button
            id="pg/add-comment"
            label="Add comment"
            icon="Plus"
            iconOnly
            style={{
              width: 20,
              height: 20,
              minWidth: 20,
              padding: 0,
              paddingLeft: 0,
              paddingRight: 0,
              borderWidth: 0,
              borderRadius: 4,
              alignSelf: "flex-start",
              backgroundColor: "#009fff",
              color: "#ffffff",
            }}
            compact
            onPress={() =>
              model.addComment(
                line.lineNumber,
                line.side as "additions" | "deletions",
                line.owner,
              )
            }
          />
        )
      : undefined,
    renderSelectionAction:
      s.selectionActions || s.example === "selection"
        ? (context) => <SelectionAction editor={context.editor} model={model} />
        : undefined,
  };
  const items = useMemo<CodeViewItem[]>(() => {
    if (s.example !== "playground" || ["file", "diff"].includes(s.viewMode))
      return [];
    const source =
      s.viewMode === "codeview"
        ? fixtures.collection
        : fixtures.virtualFiles.map((fileDiff, i) => ({
            id: "diff-" + i,
            type: "diff",
            fileDiff,
          }));
    return source.map((item) => {
      const diff =
        "fileDiff" in item ? (item.fileDiff as FileDiffMetadata) : undefined;
      const file =
        "file" in item
          ? item.file!
          : { name: diff!.name, contents: diff!.additionLines.join("") };
      return {
        id: item.id,
        annotations: s.showAnnotations
          ? (model.comments[item.id] ?? [])
              .filter((c) => !c.resolved)
              .map((c) => ({
                side: c.side,
                lineNumber: c.lineNumber,
                metadata: c,
              }))
          : [],
        file: diff ? undefined : file,
        fileDiff: diff,
        editor: model.collectionEditor(item.id, file, !!diff),
        edit: true,
      };
    });
  }, [s.example, s.viewMode, s.showAnnotations, model.comments, model]);
  const editButton = (
    id: string,
    label: "Edit" | "Cancel" | "Save",
    onPress: () => void,
  ) => (
    <Button
      id={id}
      label={label}
      compact
      onPress={onPress}
      style={{
        borderRadius: 6,
        color: label === "Save" ? "#155dfc" : "#737373",
        borderColor:
          label === "Save"
            ? "#51a2ff80"
            : systemMode === "dark"
              ? "#ffffff1a"
              : "#e5e5e5",
        backgroundColor: label === "Save" ? "#2b7fff40" : "#00000000",
        hover:
          label === "Save"
            ? { backgroundColor: "#2b7fff59" }
            : label === "Cancel"
              ? {
                  borderColor: "#ffa2a2",
                  backgroundColor: "#fef2f2",
                  color: "#e7000b",
                }
              : {
                  borderColor: "#d4d4d4",
                  backgroundColor: "#f5f5f5",
                  color: "#404040",
                },
      }}
    >
      <Label
        size={12}
        style={{ fontWeight: 400, lineHeight: 16, color: undefined }}
      >
        {label}
      </Label>
    </Button>
  );
  const editControls = (editor = model.current, owner = "") => (
    <Box style={{ ...row, gap: 6, marginRight: -8 }}>
      {editor.options.readOnly ? (
        editButton("pg/start-edit" + owner, "Edit", () =>
          model.beginEdit(editor),
        )
      ) : (
        <>
          {editButton("pg/reject-edit" + owner, "Cancel", () =>
            model.finishEdit(false, editor),
          )}
          {editButton("pg/accept-edit" + owner, "Save", () =>
            model.finishEdit(true, editor),
          )}
        </>
      )}
    </Box>
  );
  return (
    <UIProvider theme={theme}>
      <Part
        component="playground"
        name="Root"
        id="pg/root"
        style={{
          ...column,
          width: "100%",
          height: "100%",
          backgroundColor: theme.colors.page,
          alignItems: "center",
        }}
      >
        <Box
          style={{
            ...column,
            width: "100%",
            maxWidth: size.width >= 1280 ? 1280 : 1024,
            paddingLeft: 20,
            paddingRight: 20,
            height: "100%",
            minHeight: 0,
          }}
        >
          <Box
            style={{
              ...column,
              paddingTop: 32,
              gap: 24,
              flexGrow: 1,
              minHeight: 0,
              paddingBottom: 16,
            }}
          >
            {size.width >= 768 ? (
              <Controls model={model} />
            ) : (
              <Box style={{ ...column, gap: 12, flexShrink: 0 }}>
                <Box style={{ ...row, gap: 8 }}>
                  <Button
                    id="pg/open-options"
                    label="Options"
                    icon="Paragraph"
                    onPress={() => setOptionsOpen(true)}
                  />
                  <Box style={{ flexGrow: 1 }} />
                  <Button
                    id="pg/copy-link"
                    label="Copy link"
                    icon="Link"
                    onPress={async () => {
                      await copyText(model.link());
                      model.update({ notice: "Link copied." });
                    }}
                  />
                </Box>
                <Menu
                  id="pg/examples-compact"
                  label={
                    s.example === "playground"
                      ? "Edit examples"
                      : EXAMPLES.find((e) => e.value === s.example)!.label
                  }
                  value={s.example}
                  items={EXAMPLES}
                  icon="Code"
                  onChange={(example) => model.setExample(example)}
                />
              </Box>
            )}
            {s.notice && (
              <Part
                component="playground"
                name="Status"
                id="pg/status"
                role="status"
                style={{ flexShrink: 0 }}
              >
                <Label size={12} tone="muted">
                  {s.notice}
                </Label>
              </Part>
            )}
            <Part
              component="playground"
              name="Examples"
              id="pg/content"
              style={{
                ...row,
                flexDirection: size.width < 760 ? "column" : "row",
                alignItems: "stretch",
                gap: 16,
                flexGrow: 1,
                flexBasis: 0,
                minHeight: 0,
                minWidth: 0,
              }}
            >
              <Box
                style={{
                  ...column,
                  flexGrow: 1,
                  flexBasis: 0,
                  minWidth: 0,
                  minHeight: 0,
                }}
              >
                {s.example !== "playground" ? (
                  <ExampleView
                    model={model}
                    options={options}
                    common={common}
                  />
                ) : s.viewMode === "file" ? (
                  <Card id="pg/file-card" style={{ height: "100%" }}>
                    <File
                      {...common}
                      id="pg/file"
                      file={fixtures.file}
                      editor={model.file}
                      lineAnnotations={annotations}
                      renderHeaderMetadata={() => editControls()}
                    />
                  </Card>
                ) : s.viewMode === "diff" ? (
                  <Card id="pg/diff-card" style={{ height: "100%" }}>
                    <FileDiff
                      {...common}
                      id="pg/diff"
                      oldFile={fixtures.oldFile}
                      newFile={model.baseline}
                      editor={model.diff}
                      lineAnnotations={annotations}
                      renderHeaderMetadata={() => editControls()}
                    />
                  </Card>
                ) : (
                  <Card id="pg/collection-card" style={{ height: "100%" }}>
                    <CodeView
                      {...common}
                      id="pg/collection"
                      items={items}
                      options={options}
                      renderHeaderMetadata={(file) => {
                        const item = items.find(
                          (i) =>
                            (i.file?.name ?? i.fileDiff?.name) === file.name,
                        );
                        return item?.editor
                          ? editControls(item.editor, "/" + item.id)
                          : null;
                      }}
                    />
                  </Card>
                )}
              </Box>
              {s.selectionActions && s.example === "playground" && (
                <ChatPanel model={model} />
              )}
            </Part>
          </Box>
        </Box>
        {optionsOpen && (
          <OptionsDialog close={() => setOptionsOpen(false)}>
            <Controls model={model} share={false} />
          </OptionsDialog>
        )}
      </Part>
    </UIProvider>
  );
}
