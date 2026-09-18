from texture_mesh import delaunay2d, pick_in_order


def test_square_two_tris():
    pts = [(0, 0, 0), (1, 0, 1), (1, 1, 2), (0, 1, 3)]
    tris = delaunay2d(pts)
    assert len(tris) == 2, tris


def test_pick_in_order():
    images = [(f"{i:06d}.jpg", [(0, 0, j) for j in range(8)]) for i in range(1, 11)]
    picked = pick_in_order(images, max_images=4)
    names = [n for n, _ in picked]
    assert names[0] == "000001.jpg"
    assert names[-1] == "000010.jpg"
    assert names == sorted(names)


if __name__ == "__main__":
    test_square_two_tris()
    test_pick_in_order()
    print("ok")
