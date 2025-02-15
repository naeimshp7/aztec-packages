#pragma once
#include "barretenberg/common/streams.hpp"
#include "barretenberg/crypto/sha256/sha256.hpp"
#include "barretenberg/ecc/curves/bn254/bn254.hpp"
#include "barretenberg/ecc/curves/bn254/fr.hpp"
#include "barretenberg/plonk/proof_system/types/polynomial_manifest.hpp"
#include "barretenberg/polynomials/evaluation_domain.hpp"
#include "barretenberg/serialize/msgpack.hpp"
#include "barretenberg/srs/global_crs.hpp"
#include <map>

namespace proof_system::plonk {

struct verification_key_data {
    uint32_t circuit_type;
    uint32_t circuit_size;
    uint32_t num_public_inputs;
    std::map<std::string, barretenberg::g1::affine_element> commitments;
    bool contains_recursive_proof = false;
    std::vector<uint32_t> recursive_proof_public_input_indices;

    // for serialization: update with any new fields
    MSGPACK_FIELDS(circuit_type,
                   circuit_size,
                   num_public_inputs,
                   commitments,
                   contains_recursive_proof,
                   recursive_proof_public_input_indices);
    barretenberg::fr compress_native(size_t const hash_index = 0) const;
};

template <typename B> inline void read(B& buf, verification_key_data& key)
{
    using serialize::read;
    read(buf, key.circuit_type);
    read(buf, key.circuit_size);
    read(buf, key.num_public_inputs);
    read(buf, key.commitments);
    read(buf, key.contains_recursive_proof);
    read(buf, key.recursive_proof_public_input_indices);
}

template <typename B> inline void write(B& buf, verification_key_data const& key)
{
    using serialize::write;
    write(buf, key.circuit_type);
    write(buf, key.circuit_size);
    write(buf, key.num_public_inputs);
    write(buf, key.commitments);
    write(buf, key.contains_recursive_proof);
    write(buf, key.recursive_proof_public_input_indices);
}

inline std::ostream& operator<<(std::ostream& os, verification_key_data const& key)
{
    return os << "key.circuit_type: " << static_cast<uint32_t>(key.circuit_type) << "\n"
              << "key.circuit_size: " << static_cast<uint32_t>(key.circuit_size) << "\n"
              << "key.num_public_inputs: " << static_cast<uint32_t>(key.num_public_inputs) << "\n"
              << "key.commitments: " << key.commitments << "\n"
              << "key.contains_recursive_proof: " << key.contains_recursive_proof << "\n"
              << "key.recursive_proof_public_input_indices: " << key.recursive_proof_public_input_indices << "\n";
};

inline bool operator==(verification_key_data const& lhs, verification_key_data const& rhs)
{
    return lhs.circuit_type == rhs.circuit_type && lhs.circuit_size == rhs.circuit_size &&
           lhs.num_public_inputs == rhs.num_public_inputs && lhs.commitments == rhs.commitments;
}

struct verification_key {
    // default constructor needed for msgpack unpack
    verification_key() = default;
    verification_key(verification_key_data&& data,
                     std::shared_ptr<barretenberg::srs::factories::VerifierCrs<curve::BN254>> const& crs);
    verification_key(const size_t num_gates,
                     const size_t num_inputs,
                     std::shared_ptr<barretenberg::srs::factories::VerifierCrs<curve::BN254>> const& crs,
                     CircuitType circuit_type);

    verification_key(const verification_key& other);
    verification_key(verification_key&& other);
    verification_key& operator=(verification_key&& other);

    ~verification_key() = default;

    sha256::hash sha256_hash();

    verification_key_data as_data() const
    {
        return {
            .circuit_type = static_cast<uint32_t>(circuit_type),
            .circuit_size = static_cast<uint32_t>(circuit_size),
            .num_public_inputs = static_cast<uint32_t>(num_public_inputs),
            .commitments = commitments,
            .contains_recursive_proof = contains_recursive_proof,
            .recursive_proof_public_input_indices = recursive_proof_public_input_indices,
        };
    }

    CircuitType circuit_type;
    size_t circuit_size;
    size_t log_circuit_size;
    size_t num_public_inputs;

    barretenberg::evaluation_domain domain;

    std::shared_ptr<barretenberg::srs::factories::VerifierCrs<curve::BN254>> reference_string;

    std::map<std::string, barretenberg::g1::affine_element> commitments;

    PolynomialManifest polynomial_manifest;

    // This is a member variable so as to avoid recomputing it in the different places of the verifier algorithm.
    // Note that recomputing would also have added constraints to the recursive verifier circuit.
    barretenberg::fr z_pow_n; // ʓ^n (ʓ being the 'evaluation challenge')

    bool contains_recursive_proof = false;
    std::vector<uint32_t> recursive_proof_public_input_indices;
    size_t program_width = 3;

    // for serialization: update with new fields
    void msgpack_pack(auto& packer) const
    {
        verification_key_data data = { static_cast<uint32_t>(circuit_type),
                                       static_cast<uint32_t>(circuit_size),
                                       static_cast<uint32_t>(num_public_inputs),
                                       commitments,
                                       contains_recursive_proof,
                                       recursive_proof_public_input_indices };
        packer.pack(data);
    }
    void msgpack_unpack(auto obj)
    {
        verification_key_data data = obj;
        *this = verification_key{ std::move(data), barretenberg::srs::get_crs_factory()->get_verifier_crs() };
    }
    // Alias verification_key as verification_key_data in the schema
    void msgpack_schema(auto& packer) const { packer.pack_schema(proof_system::plonk::verification_key_data{}); }
};

template <typename B> inline void read(B& buf, verification_key& key)
{
    using serialize::read;
    verification_key_data vk_data;
    read(buf, vk_data);
    key = verification_key{ std::move(vk_data), barretenberg::srs::get_crs_factory()->get_verifier_crs() };
}

template <typename B> inline void read(B& buf, std::shared_ptr<verification_key>& key)
{
    using serialize::read;
    verification_key_data vk_data;
    read(buf, vk_data);
    key = std::make_shared<verification_key>(std::move(vk_data),
                                             barretenberg::srs::get_crs_factory()->get_verifier_crs());
}

template <typename B> inline void write(B& buf, verification_key const& key)
{
    using serialize::write;
    write(buf, key.as_data());
}

inline std::ostream& operator<<(std::ostream& os, verification_key const& key)
{
    return os << key.as_data();
};

} // namespace proof_system::plonk
