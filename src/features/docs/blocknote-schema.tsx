import { useEffect, useState } from "react";
import {
  BlockNoteSchema,
  combineByGroup,
  defaultBlockSpecs,
  defaultProps,
  withPageBreak,
  type BlockNoteEditor,
} from "@blocknote/core";
import { insertOrUpdateBlockForSlashMenu } from "@blocknote/core/extensions";
import {
  createReactBlockSpec,
  getDefaultReactSlashMenuItems,
  getPageBreakReactSlashMenuItems,
  type DefaultReactSuggestionItem,
} from "@blocknote/react";
import { en as coreEnDictionary } from "@blocknote/core/locales";
import {
  getMultiColumnSlashMenuItems,
  locales as multiColumnLocales,
  withMultiColumn,
} from "@blocknote/xl-multi-column";

const CALLOUT_EMOJIS = ["💡", "📌", "⚠️", "✅", "❌", "🔥", "📝", "❓"];

// getMultiColumnSlashMenuItems reads editor.dictionary.multi_column and
// throws if it's missing — it isn't part of BlockNote core's own dictionary,
// so it must be merged in explicitly when creating the editor.
export const docsDictionary = {
  ...coreEnDictionary,
  multi_column: multiColumnLocales.en,
};

const CalloutBlock = createReactBlockSpec(
  {
    type: "callout",
    propSchema: {
      textAlignment: defaultProps.textAlignment,
      textColor: defaultProps.textColor,
      backgroundColor: defaultProps.backgroundColor,
      emoji: { default: "💡" },
    },
    content: "inline",
  },
  {
    render: ({ block, editor, contentRef }) => {
      const [pickerOpen, setPickerOpen] = useState(false);
      const isEditable = editor.isEditable;

      // The slash menu converts the current (empty) paragraph in place, so
      // shared prop keys like backgroundColor keep their old "default" value
      // instead of picking up this type's own default — patch it once here.
      useEffect(() => {
        if (!block.content.length && block.props.backgroundColor === "default") {
          setTimeout(() => {
            editor.updateBlock(block, { props: { backgroundColor: "yellow" } });
          }, 0);
        }
      }, [block, editor]);

      return (
        <div className="flex flex-1 items-start gap-2.5">
          <div className="relative shrink-0" contentEditable={false}>
            <button
              type="button"
              disabled={!isEditable}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setPickerOpen((v) => !v);
              }}
              className="w-7 h-7 flex items-center justify-center rounded text-lg leading-none hover:enabled:bg-black/10"
            >
              {block.props.emoji}
            </button>
            {pickerOpen && (
              <>
                {/* Click-outside layer to dismiss the picker */}
                <div className="fixed inset-0 z-10" onClick={() => setPickerOpen(false)} />
                <div className="absolute z-20 top-full left-0 mt-1 flex gap-0.5 p-1.5 bg-white border border-gray-200 rounded-lg shadow-lg">
                  {CALLOUT_EMOJIS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => {
                        editor.updateBlock(block, { props: { emoji } });
                        setPickerOpen(false);
                      }}
                      className="w-7 h-7 flex items-center justify-center rounded text-lg leading-none hover:bg-gray-100"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <p className="flex-1 min-w-0 py-0.5" ref={contentRef} />
        </div>
      );
    },
  },
);

function getCalloutSlashMenuItems(
  editor: BlockNoteEditor<any, any, any>, // eslint-disable-line @typescript-eslint/no-explicit-any
): DefaultReactSuggestionItem[] {
  return [
    {
      title: "Callout",
      onItemClick: () => {
        insertOrUpdateBlockForSlashMenu(editor, { type: "callout" });
      },
      aliases: ["callout", "note", "highlight", "info"],
      group: "Basic blocks",
      icon: <span className="text-base leading-none">💡</span>,
      subtext: "Highlight important information",
    },
  ];
}

// withPageBreak/withMultiColumn extend the schema type as they're applied, so
// the exported schema's block/inline-content/style types already reflect
// paragraph, heading, callout, pageBreak, column and columnList.
export const docsBlockNoteSchema = withMultiColumn(
  withPageBreak(
    BlockNoteSchema.create({
      blockSpecs: {
        ...defaultBlockSpecs,
        callout: CalloutBlock(),
      },
    }),
  ),
);

export function getDocsSlashMenuItems(
  editor: BlockNoteEditor<any, any, any>, // eslint-disable-line @typescript-eslint/no-explicit-any
): DefaultReactSuggestionItem[] {
  return combineByGroup(
    getDefaultReactSlashMenuItems(editor),
    getPageBreakReactSlashMenuItems(editor),
    getMultiColumnSlashMenuItems(editor),
    getCalloutSlashMenuItems(editor),
  );
}
