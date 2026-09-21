export type TgUser = { id: number; first_name?: string; username?: string }

export type TgMessage = {
  message_id: number
  from?: TgUser
  chat: { id: number }
  date: number
  text?: string
}

export type TgReactionUpdate = {
  chat: { id: number }
  message_id: number
  user?: TgUser
  new_reaction: { type: string; emoji?: string }[]
}

export type TgUpdate = {
  update_id: number
  message?: TgMessage
  message_reaction?: TgReactionUpdate
}
