mod field_serialisation;
mod u32_serialisation;

/**
 * Before Noir supports traits, a way of specifying the serialisation and deserialisation methods for a type.
 */
struct TypeSerialisationInterface<T, N> {
    deserialise: fn ([Field; N]) -> T,
    serialise: fn (T) -> [Field; N],
}