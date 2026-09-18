import numpy as np

def detect_planes_ransac(points, distance_threshold=0.05, max_iterations=1000, num_planes=5):
    """
    Detect multiple planes in a point cloud using RANSAC.
    
    Args:
        points: numpy array of shape (N, 3) representing 3D points
        distance_threshold: maximum distance for a point to be considered an inlier
        max_iterations: number of RANSAC iterations per plane
        num_planes: maximum number of planes to detect
        
    Returns:
        planes: list of dicts with 'equation' [A, B, C, D] and 'inliers' (indices)
        remaining_points: points that don't belong to any detected plane
    """
    planes = []
    remaining_indices = np.arange(len(points))
    
    for _ in range(num_planes):
        if len(remaining_indices) < 3:
            break
            
        best_eq = None
        best_inliers = []
        
        current_points = points[remaining_indices]
        n_points = len(current_points)
        
        for _ in range(max_iterations):
            # Randomly select 3 points
            sample_idx = np.random.choice(n_points, 3, replace=False)
            p1, p2, p3 = current_points[sample_idx]
            
            # Calculate plane normal
            v1 = p2 - p1
            v2 = p3 - p1
            normal = np.cross(v1, v2)
            
            # Check if points are collinear
            norm_length = np.linalg.norm(normal)
            if norm_length < 1e-6:
                continue
                
            normal = normal / norm_length
            
            # Plane equation: Ax + By + Cz + D = 0
            A, B, C = normal
            D = -np.dot(normal, p1)
            
            # Calculate distances from all points to the plane
            distances = np.abs(np.dot(current_points, normal) + D)
            
            # Find inliers
            inliers = np.where(distances < distance_threshold)[0]
            
            if len(inliers) > len(best_inliers):
                best_inliers = inliers
                best_eq = [A, B, C, D]
                
        if len(best_inliers) < 10:  # Minimum points to form a valid plane
            break
            
        # Map back to original indices
        original_inliers = remaining_indices[best_inliers]
        
        # Refine plane equation using least squares on all inliers
        inlier_points = points[original_inliers]
        centroid = np.mean(inlier_points, axis=0)
        centered_points = inlier_points - centroid
        
        # SVD for plane fitting
        _, _, vh = np.linalg.svd(centered_points)
        normal = vh[2, :]
        
        # Ensure consistent normal direction (pointing towards origin)
        if np.dot(normal, centroid) > 0:
            normal = -normal
            
        A, B, C = normal
        D = -np.dot(normal, centroid)
        refined_eq = [A, B, C, D]
        
        planes.append({
            'equation': refined_eq,
            'inliers': original_inliers.tolist()
        })
        
        # Remove inliers for next iteration
        mask = np.ones(len(remaining_indices), dtype=bool)
        mask[best_inliers] = False
        remaining_indices = remaining_indices[mask]
        
    return planes, remaining_indices

def classify_plane(normal, up_vector=np.array([0, 1, 0]), angle_threshold_deg=25):
    """
    Classify a plane as FLOOR, CEILING, or WALL based on its normal.
    
    Args:
        normal: plane normal vector [A, B, C]
        up_vector: gravity/up vector
        angle_threshold_deg: tolerance angle in degrees
        
    Returns:
        string: 'FLOOR', 'CEILING', 'WALL', or 'UNKNOWN'
    """
    normal = np.array(normal)
    normal = normal / np.linalg.norm(normal)
    
    up_vector = np.array(up_vector)
    up_vector = up_vector / np.linalg.norm(up_vector)
    
    dot_product = np.dot(normal, up_vector)
    angle_deg = np.degrees(np.arccos(np.clip(dot_product, -1.0, 1.0)))
    
    # Floor: normal points UP (parallel to up_vector)
    if angle_deg < angle_threshold_deg:
        return 'FLOOR'
        
    # Ceiling: normal points DOWN (anti-parallel to up_vector)
    if angle_deg > 180 - angle_threshold_deg:
        return 'CEILING'
        
    # Wall: normal is perpendicular to up_vector
    if abs(angle_deg - 90) < angle_threshold_deg + 15: # Increased tolerance for walls
        return 'WALL'
        
    return 'UNKNOWN'
