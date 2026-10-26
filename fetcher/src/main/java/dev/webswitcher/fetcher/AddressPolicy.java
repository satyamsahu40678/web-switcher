package dev.webswitcher.fetcher;

import java.net.InetAddress;

/** Conservative public unicast policy; special-purpose ranges are never probe targets. */
public final class AddressPolicy {
    private AddressPolicy() {}

    public static void requirePublic(InetAddress address) {
        byte[] bytes = address.getAddress();
        if (address.isAnyLocalAddress() || address.isLoopbackAddress() || address.isLinkLocalAddress()
                || address.isSiteLocalAddress() || address.isMulticastAddress()) {
            throw new IllegalArgumentException("NON_PUBLIC_ADDRESS");
        }
        if (bytes.length == 4) {
            long value = ((long) (bytes[0] & 255) << 24) | ((long) (bytes[1] & 255) << 16)
                    | ((long) (bytes[2] & 255) << 8) | (bytes[3] & 255);
            long[][] ranges = {
                    {0x00000000L,8}, {0x0a000000L,8}, {0x64400000L,10}, {0x7f000000L,8},
                    {0xa9fe0000L,16}, {0xac100000L,12}, {0xc0000000L,24}, {0xc0000200L,24},
                    {0xc0586300L,24}, {0xc0a80000L,16}, {0xc6120000L,15}, {0xc6336400L,24},
                    {0xcb007100L,24}, {0xe0000000L,3}
            };
            for (long[] range : ranges) {
                long mask = (0xffffffffL << (32 - range[1])) & 0xffffffffL;
                if ((value & mask) == range[0]) throw new IllegalArgumentException("NON_PUBLIC_ADDRESS");
            }
            return;
        }
        // Only globally allocated IPv6 unicast. This excludes NAT64/translation, mapped IPv4,
        // local, unspecified, multicast and other transition addresses by construction.
        if (bytes.length != 16 || (bytes[0] & 0xe0) != 0x20) throw new IllegalArgumentException("NON_PUBLIC_ADDRESS");
        if ((bytes[0] & 255) == 0x20 && (bytes[1] & 255) == 1
                && (((bytes[2] & 0xfe) == 0) || ((bytes[2] & 255) == 0x0d && (bytes[3] & 255) == 0xb8))) {
            throw new IllegalArgumentException("NON_PUBLIC_ADDRESS");
        }
        if (((bytes[0] & 255) == 0x20 && (bytes[1] & 255) == 2)
                || ((bytes[0] & 255) == 0x3f && ((bytes[1] & 255) == 0xfe || ((bytes[1] & 255) == 0xff && (bytes[2] & 0xf0) == 0)))) {
            throw new IllegalArgumentException("NON_PUBLIC_ADDRESS");
        }
    }

    public static InetAddress[] requireAllPublic(InetAddress[] addresses) {
        if (addresses == null || addresses.length == 0 || addresses.length > 16) throw new IllegalArgumentException("DNS_ANSWER_LIMIT");
        for (InetAddress address : addresses) requirePublic(address);
        return addresses.clone();
    }
}
