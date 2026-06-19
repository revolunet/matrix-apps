import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { EntityConfig } from "@/entities/types";
import { EntityFormField } from "./EntityFormField";

interface Props {
  config: EntityConfig;
  defaultValues?: Record<string, unknown>;
  onSubmit: (data: Record<string, unknown>) => Promise<void>;
  submitLabel?: string;
}

export function EntityForm({
  config,
  defaultValues,
  onSubmit,
  submitLabel = "Save",
}: Props) {
  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(config.formSchema as any),
    defaultValues,
  });

  return (
    <form
      onSubmit={handleSubmit((data) => onSubmit(data as Record<string, unknown>))}
      className="space-y-4 max-w-md"
    >
      {config.fields.map((field) => (
        <EntityFormField
          key={field.name}
          field={field}
          register={register}
          control={control}
          errors={errors}
        />
      ))}

      <button
        type="submit"
        disabled={isSubmitting}
        className="bg-black text-white text-sm px-4 py-2 rounded hover:bg-gray-800 disabled:opacity-50"
      >
        {isSubmitting ? "Saving..." : submitLabel}
      </button>
    </form>
  );
}
