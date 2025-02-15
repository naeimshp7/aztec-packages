#pragma once
#include <algorithm>
#include <stddef.h>
#include <string>
#include <vector>

template <typename C> C slice(C const& container, size_t start)
{
    auto b = container.begin();
    auto e = container.end();
    std::advance(b, start);
    return C(b, e);
}

template <typename C> C slice(C const& container, size_t start, size_t end)
{
    auto b = container.begin();
    auto e = container.begin();
    std::advance(b, start);
    std::advance(e, end);
    return C(b, e);
}

template <typename C> C join(std::initializer_list<C> to_join)
{
    C result;
    for (auto& e : to_join) {
        result.insert(result.end(), e.begin(), e.end());
    }
    return result;
}

inline std::string join(std::vector<std::string> const& to_join, std::string const& with = ",")
{
    auto it = to_join.begin();
    std::string result(*it++);
    for (; it != to_join.end(); ++it) {
        result += with;
        result += *it;
    }
    return result;
}

template <template <typename, typename...> typename Cont, typename InnerCont, typename... Args>
InnerCont flatten(Cont<InnerCont, Args...> const& in)
{
    InnerCont result;
    for (auto& e : in) {
        result.insert(result.end(), e.begin(), e.end());
    }
    return result;
}

// Return the first index at which a given item can be found in the vector.
// Only safe for vectors with length less than the size_t overflow size.
template <typename T> long index_of(std::vector<T> const& vec, T const& item)
{
    auto const& begin = vec.begin();
    auto const& end = vec.end();

    auto const& itr = std::find(begin, end, item);

    return itr == end ? -1 : std::distance(begin, itr);
}