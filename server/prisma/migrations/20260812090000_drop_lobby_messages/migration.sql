/*
  The app's single public room is gone, replaced by direct messages between two
  accounts (`DirectMessage`, added in 20260811123606_add_direct_messages).

  Warning: this drops the table and everything said in it. That is the intent —
  the room no longer exists in the product, and keeping an unreadable table of
  messages nobody can reach would be holding people's words for no purpose.

  Deliberately a second migration rather than part of the one that added
  `DirectMessage`: every commit in between built the new feature alongside the
  old one, so `main` ran at each step.

  The indexes and the foreign key go with the table; naming them is unnecessary.
*/
DROP TABLE "LobbyMessage";
