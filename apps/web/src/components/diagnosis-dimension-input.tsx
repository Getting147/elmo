import { type ComponentProps, useEffect, useRef, useState } from "react";

type Props = Omit<ComponentProps<"input">, "value" | "onChange" | "onBlur"> & {
	value: string;
	onCommit: (value: string) => Promise<void>;
	onComposing: (value: boolean) => void;
};

// React must receive the value synchronously while the IME owns the input.
export function DiagnosisDimensionInput({ value, onCommit, onComposing, disabled, ...props }: Props) {
	const [text, setText] = useState(value);
	const editing = useRef(false);
	const composing = useRef(false);
	useEffect(() => {
		if (!editing.current || disabled) setText(value);
	}, [value, disabled]);
	const commit = (next: string) => onCommit(next).catch(() => {});
	return (
		<input
			{...props}
			disabled={disabled}
			value={text}
			onFocus={() => {
				editing.current = true;
			}}
			onChange={(event) => {
				setText(event.currentTarget.value);
				if (!composing.current) void commit(event.currentTarget.value);
			}}
			onCompositionStart={() => {
				composing.current = true;
				onComposing(true);
			}}
			onCompositionEnd={(event) => {
				composing.current = false;
				onComposing(false);
				setText(event.currentTarget.value);
				void commit(event.currentTarget.value);
			}}
			onBlur={(event) => {
				composing.current = false;
				onComposing(false);
				void commit(event.currentTarget.value).then(() => {
					editing.current = false;
				});
			}}
		/>
	);
}
