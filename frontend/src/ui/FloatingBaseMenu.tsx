import { FloatingHandle, FloatingContainer, FloatingTrigger, ProtoButton } from "@opencast/appkit";
import React, { ReactElement } from "react";
import { FiChevronDown } from "react-icons/fi";
import { focusStyle } from ".";
import { COLORS } from "../color";
import { CSSObject } from "@emotion/react";


type FloatingBaseMenuProps = {
    triggerContent: ReactElement;
    list: ReactElement;
    label: string;
    triggerStyles?: CSSObject;
};


// TODO: Make menus work with arrow keys.
export const FloatingBaseMenu = React.forwardRef<FloatingHandle, FloatingBaseMenuProps>(
    ({ triggerContent, list, label, triggerStyles }, ref) => (
        <FloatingContainer
            ref={ref}
            placement="bottom"
            trigger="click"
            ariaRole="menu"
            distance={0}
            borderRadius={8}
        >
            <FloatingTrigger>
                <ProtoButton aria-label={label} css={{
                    display: "flex",
                    alignItems: "center",
                    border: `1px solid ${COLORS.neutral40}`,
                    borderRadius: 4,
                    gap: 8,
                    height: 31,
                    padding: "0 8px",
                    whiteSpace: "nowrap",
                    ":hover, :focus": { backgroundColor: COLORS.neutral15 },
                    ":focus-visible": { borderColor: COLORS.focus },
                    ...focusStyle({ offset: -1 }),
                    ...triggerStyles,
                }}>
                    {triggerContent}
                    <FiChevronDown css={{ fontSize: 20, flexShrink: 0 }} />
                </ProtoButton>
            </FloatingTrigger>
            {list}
        </FloatingContainer>
    ),
);
