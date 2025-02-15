use dep::std::hash::pedersen_with_separator;
use crate::context::Context;
use crate::note::lifecycle::create_note;
use crate::note::note_getter::{
    get_note,
    ensure_note_exists,
};
use crate::note::note_interface::NoteInterface;
use crate::oracle;
use crate::constants_gen::{
    GENERATOR_INDEX__INITIALISATION_NULLIFIER,
    EMPTY_NULLIFIED_COMMITMENT,
};

struct ImmutableSingleton<Note, N> {
    storage_slot: Field,
    note_interface: NoteInterface<Note, N>,
}

impl<Note, N> ImmutableSingleton<Note, N> {
    fn new(storage_slot: Field, note_interface: NoteInterface<Note, N>) -> Self {
        ImmutableSingleton { storage_slot, note_interface }
    }

    unconstrained fn is_initialised(self) -> bool {
        let nullifier = self.compute_initialisation_nullifier();
        oracle::notes::is_nullifier_emitted(nullifier)
    }

    fn initialise(self, context: &mut Context, note: &mut Note) {
        // Nullify the storage slot.
        let nullifier = self.compute_initialisation_nullifier();
        context.push_new_nullifier(nullifier, EMPTY_NULLIFIED_COMMITMENT);

        create_note(context, self.storage_slot, note, self.note_interface);
    }

    fn compute_initialisation_nullifier(self) -> Field {
        pedersen_with_separator([self.storage_slot], GENERATOR_INDEX__INITIALISATION_NULLIFIER)[0]
    }
    
    fn get_note(self, context: &mut Context) -> Note {
        let storage_slot = self.storage_slot;
        get_note(context, storage_slot, self.note_interface)
    }

    fn assert_contains(self, context: &mut Context, note: &mut Note) {
        ensure_note_exists(context, self.storage_slot, self.note_interface, note);
    }
}